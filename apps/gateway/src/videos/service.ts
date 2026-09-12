import type { DeploymentCandidate } from "#gateway/deploymentCandidates.ts";
import { getEffectiveSettings } from "#router/settings.ts";
import { resolveModelMetadata } from "#catalog/index.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { resolveTransport } from "#router/transport.ts";
import { getAdapter } from "#adapters/registry.ts";
import { GatewayError } from "#core/errors.ts";
import { decryptRecord } from "#db/crypto.ts";
import { randomUUID } from "node:crypto";
import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";

import {
	markVideoAssetsDeleted,
	listExpiredVideoAssets,
	updateVideoJobState,
	type VideoAssetRow,
	claimDueVideoJobs,
	type VideoJobRow,
	getVideoJobById,
	storeVideoAsset,
	getVideoAsset,
} from "#db/repos/videos.ts";

import type {
	CanonicalVideoProviderJob,
	CanonicalVideoObject,
	VideoAssetVariant,
	VideoQuality,
	VideoStatus,
} from "#core/videos.ts";

import {
	contentTypeForKey,
	type ObjectRange,
	getObjectStore,
	objectKey,
} from "#storage/objectStore.ts";

import {
	type DeploymentRow,
	getDeploymentById,
} from "#db/repos/deployments.ts";

const TERMINAL_STATUSES = new Set(["completed", "failed", "deleted"]);

export function newVideoId(): string {
	return `video_${randomUUID().replaceAll("-", "")}`;
}

export function videoObjectFromRow(row: VideoJobRow): CanonicalVideoObject {
	return {
		id: row.id,
		model: row.publicModel,
		status: row.status === "deleted" ? "failed" : (row.status as VideoStatus),
		progress: row.progress,
		prompt: row.prompt,
		createdAt: row.createdAt,
		completedAt: row.completedAt,
		expiresAt: row.expiresAt,
		error: (row.error as CanonicalVideoObject["error"]) ?? null,
		remixedFromVideoId: null,
		...(row.seconds !== null ? { seconds: row.seconds } : {}),
		...(row.size !== null ? { size: row.size } : {}),
		...(row.quality !== null ? { quality: row.quality as VideoQuality } : {}),
	};
}

function nextPollAt(
	job: CanonicalVideoProviderJob,
	pollIntervalSeconds?: number,
): Date | null {
	if (job.status === "completed" || job.status === "failed") return null;
	return new Date(
		Date.now() +
			(pollIntervalSeconds ?? env.VIDEO_JOB_POLL_INTERVAL_MS / 1000) * 1000,
	);
}

function shouldTimeOut(row: VideoJobRow, now = new Date()): boolean {
	return (
		now.getTime() - row.createdAt.getTime() >
		env.VIDEO_JOB_MAX_RUNTIME_MINUTES * 60 * 1000
	);
}

async function candidateFromJob(
	row: VideoJobRow,
	signal?: AbortSignal,
	mode: "json" | "stream" = "json",
): Promise<{
	candidate: DeploymentCandidate;
	ctx: AdapterContext;
	cleanup: () => void;
}> {
	const deployment = await getDeploymentById(row.deploymentId ?? "");
	if (!deployment) {
		throw new GatewayError({
			class: "server",
			code: "video_deployment_missing",
			message: `Video job ${row.id} references missing deployment ${row.deploymentId}`,
		});
	}
	const adapter = getAdapter(deployment.adapterKey);
	if (!adapter?.videoGeneration) {
		throw new GatewayError({
			class: "server",
			code: "video_adapter_missing",
			message: `Adapter "${deployment.adapterKey}" does not implement video generation`,
		});
	}
	const meta = resolveModelMetadata(
		deployment.adapterKey,
		deployment.upstreamModel,
		deployment.catalogEntry,
		deployment.pricing,
	);
	const candidate: DeploymentCandidate = {
		row: deployment as DeploymentRow,
		adapter,
		upstreamModel: deployment.upstreamModel,
		meta,
	};
	const settings = await getEffectiveSettings();
	const timeoutMs =
		settings.executionPolicies["videos.generations"][mode].totalMs;
	const controller = new AbortController();
	const abortFromCaller = () =>
		controller.abort({ owner: "client", type: "cancelled" });
	if (signal?.aborted) abortFromCaller();
	else signal?.addEventListener("abort", abortFromCaller, { once: true });
	const timer = setTimeout(
		() =>
			controller.abort({
				owner: "gateway",
				type: "timeout",
				phase: mode === "stream" ? "streaming" : "headers",
			}),
		timeoutMs,
	);
	timer.unref?.();
	const ctx: AdapterContext = {
		upstreamModel: deployment.upstreamModel,
		credentials: decryptRecord(
			deployment.credentials,
			"deployment-credentials",
		),
		meta,
		transport: resolveTransport(candidate, "videos.generations"),
		requestId: row.id,
		executionPolicy: settings.executionPolicies["videos.generations"][mode],
		diagnostics: {},
		signal: controller.signal,
	};
	return {
		candidate,
		ctx,
		cleanup: () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", abortFromCaller);
			if (!controller.signal.aborted)
				controller.abort({ owner: "gateway", type: "settled" });
		},
	};
}

async function applyProviderJob(
	row: VideoJobRow,
	job: CanonicalVideoProviderJob,
	pollIntervalSeconds?: number,
): Promise<VideoJobRow> {
	const now = new Date();
	const updated = await updateVideoJobState(row.id, {
		status: job.status,
		progress: Math.max(
			0,
			Math.min(
				100,
				job.progress ?? (job.status === "completed" ? 100 : row.progress),
			),
		),
		error: job.error ?? null,
		usage: job.usage ?? row.usage,
		upstreamGenerationId: job.upstreamGenerationId ?? row.upstreamGenerationId,
		upstreamPollingUrl: job.upstreamPollingUrl ?? row.upstreamPollingUrl,
		providerState: job.providerState ?? row.providerState,
		completedAt:
			job.status === "completed" ? (row.completedAt ?? now) : row.completedAt,
		lastPolledAt: now,
		nextPollAt: nextPollAt(job, pollIntervalSeconds),
	});
	return updated ?? row;
}

export async function refreshVideoJob(
	row: VideoJobRow,
	signal?: AbortSignal,
): Promise<VideoJobRow> {
	if (TERMINAL_STATUSES.has(row.status)) return row;
	if (shouldTimeOut(row)) {
		return (
			(await updateVideoJobState(row.id, {
				status: "failed",
				progress: row.progress,
				error: {
					code: "job_timeout",
					message: "Video generation exceeded the gateway timeout window.",
				},
				lastPolledAt: new Date(),
				nextPollAt: null,
			})) ?? row
		);
	}
	const { candidate, ctx, cleanup } = await candidateFromJob(row, signal);
	try {
		const providerJob = await candidate.adapter.videoGeneration!.refresh(
			{
				upstreamJobId: row.upstreamJobId,
				upstreamGenerationId: row.upstreamGenerationId,
				upstreamPollingUrl: row.upstreamPollingUrl,
				providerState: row.providerState,
			},
			ctx,
		);
		return applyProviderJob(
			row,
			providerJob,
			candidate.meta.video?.pollIntervalSeconds,
		);
	} finally {
		cleanup();
	}
}

function variantExtension(
	variant: VideoAssetVariant,
	contentType: string,
): string {
	if (variant === "video") {
		if (contentType === "video/webm") return "webm";
		return "mp4";
	}
	if (contentType === "image/png") return "png";
	return "jpg";
}

function makeObjectKey(
	row: VideoJobRow,
	variant: VideoAssetVariant,
	contentType: string,
): string {
	const date = row.createdAt;
	const yyyy = String(date.getUTCFullYear());
	const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
	const dd = String(date.getUTCDate()).padStart(2, "0");
	return objectKey("videos", [
		yyyy,
		mm,
		dd,
		row.id,
		`${variant}.${variantExtension(variant, contentType)}`,
	]);
}

export async function ensureVideoAsset(
	inputRow: VideoJobRow,
	variant: VideoAssetVariant,
	signal?: AbortSignal,
): Promise<VideoAssetRow> {
	if (inputRow.expiresAt.getTime() <= Date.now()) {
		throw new GatewayError({
			class: "not_found",
			code: "video_expired",
			message: `Video ${inputRow.id} content has expired`,
			publicMessage: "The video content has expired.",
		});
	}
	const existing = await getVideoAsset(inputRow.id, variant);
	if (existing) return existing;

	let row = inputRow;
	if (!TERMINAL_STATUSES.has(row.status))
		row = await refreshVideoJob(row, signal);
	if (row.status !== "completed") {
		throw new GatewayError({
			class: "bad_request",
			status: 409,
			code: "video_not_ready",
			message: `Video ${row.id} is not completed yet`,
			publicMessage: "The video is not completed yet.",
		});
	}

	const { candidate, ctx, cleanup } = await candidateFromJob(
		row,
		signal,
		"stream",
	);
	try {
		const content = await candidate.adapter.videoGeneration!.download(
			{
				upstreamJobId: row.upstreamJobId,
				upstreamGenerationId: row.upstreamGenerationId,
				upstreamPollingUrl: row.upstreamPollingUrl,
				providerState: row.providerState,
			},
			variant,
			ctx,
		);
		const store = getObjectStore();
		const key = makeObjectKey(row, variant, content.contentType);
		const stored = await store.put({
			key,
			body: content.body,
			contentType: content.contentType,
			...(content.contentLength !== undefined
				? { contentLength: content.contentLength }
				: {}),
		});
		return storeVideoAsset({
			videoId: row.id,
			variant,
			objectKey: key,
			storageBackend: store.backend,
			contentType: content.contentType,
			contentLength: content.contentLength ?? null,
			etag: stored.etag ?? null,
			expiresAt: row.expiresAt,
		});
	} finally {
		cleanup();
	}
}

export async function readVideoAsset(
	asset: VideoAssetRow,
	range?: ObjectRange,
) {
	if (asset.expiresAt.getTime() <= Date.now()) {
		throw new GatewayError({
			class: "not_found",
			code: "video_expired",
			message: "Video asset has expired",
			publicMessage: "The video content has expired.",
		});
	}
	return getObjectStore().get(asset.objectKey, range);
}

export async function deleteExpiredVideoAssets(): Promise<number> {
	const store = getObjectStore();
	const expired = await listExpiredVideoAssets(new Date(), 100);
	const deletedIds: string[] = [];
	for (const asset of expired) {
		try {
			await store.delete(asset.objectKey);
			deletedIds.push(asset.id);
		} catch (err) {
			log.warn("videos", "failed to delete expired video asset object", {
				err,
				assetId: asset.id,
				key: asset.objectKey,
			});
		}
	}
	await markVideoAssetsDeleted(deletedIds);
	return deletedIds.length;
}

export async function refreshDueVideoJobs(): Promise<number> {
	const rows = await claimDueVideoJobs();
	let refreshed = 0;
	for (const row of rows) {
		try {
			const updated = await refreshVideoJob(row);
			if (updated.status === "completed") {
				await ensureVideoAsset(updated, "video").catch((err: unknown) => {
					log.warn("videos", "completed video asset ingestion failed", {
						err,
						videoId: updated.id,
					});
				});
			}
			refreshed += 1;
		} catch (err) {
			log.warn("videos", "video refresh failed", { err, videoId: row.id });
		}
	}
	return refreshed;
}

export async function loadAndRefreshVideo(
	id: string,
	virtualKeyId: string | null,
	signal?: AbortSignal,
): Promise<VideoJobRow> {
	const row = await getVideoJobById(id);
	if (!row || row.deletedAt) {
		throw new GatewayError({
			class: "not_found",
			code: "video_not_found",
			message: `Video ${id} not found`,
		});
	}
	// Virtual keys only see their own jobs; the master key (null) is the operator and sees all.
	if (virtualKeyId !== null && row.virtualKeyId !== virtualKeyId) {
		throw new GatewayError({
			class: "not_found",
			code: "video_not_found",
			message: `Video ${id} not found in scope`,
		});
	}
	if (row.nextPollAt && row.nextPollAt.getTime() > Date.now()) return row;
	return refreshVideoJob(row, signal);
}

/**
 * Best-effort upstream delete/cancel after a local delete. Failures are logged, never surfaced:
 * the local soft-delete already succeeded and not every provider has a delete endpoint.
 */
export async function removeUpstreamVideo(row: VideoJobRow): Promise<void> {
	try {
		const { candidate, ctx, cleanup } = await candidateFromJob(row);
		try {
			await candidate.adapter.videoGeneration?.remove?.(
				{
					upstreamJobId: row.upstreamJobId,
					upstreamGenerationId: row.upstreamGenerationId,
					upstreamPollingUrl: row.upstreamPollingUrl,
					providerState: row.providerState,
				},
				ctx,
			);
		} finally {
			cleanup();
		}
	} catch (err) {
		log.warn("videos", "best-effort upstream video delete failed", {
			err,
			videoId: row.id,
		});
	}
}

export function storedContentHeaders(
	asset: VideoAssetRow,
): Record<string, string> {
	return {
		"content-type": asset.contentType || contentTypeForKey(asset.objectKey),
		"accept-ranges": "bytes",
		"cache-control": "private, max-age=60",
		...(asset.contentLength !== null
			? { "content-length": String(asset.contentLength) }
			: {}),
	};
}
