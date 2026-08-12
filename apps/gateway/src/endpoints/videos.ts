import { assertVideoRequestSupported } from "#gateway/videoRequestValidation.ts";
import { getObjectStore, type ObjectRange } from "#storage/objectStore.ts";
import { estimateTokenReservation } from "#router/tokenReservation.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import { route, type RouteResult } from "#router/index.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { log as systemLog } from "#logging/log.ts";
import { GatewayError } from "#core/errors.ts";
import { getAuth } from "#auth/middleware.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Context } from "hono";

import {
	storedContentHeaders,
	removeUpstreamVideo,
	loadAndRefreshVideo,
	videoObjectFromRow,
	ensureVideoAsset,
	readVideoAsset,
	newVideoId,
} from "#videos/service.ts";

import {
	PUBLIC_JSON_BODY_MAX_BYTES,
	notifyExtensionError,
	usageQuotaForRequest,
	toGatewayError,
	readJsonBody,
	parseBody,
	preflight,
} from "./runtime/pipeline.ts";

import {
	type CanonicalVideoProviderJob,
	type CanonicalVideoRequest,
	sanitizeVideoRequestBody,
	type VideoAssetVariant,
	videoUsageToCore,
} from "#core/videos.ts";

import {
	videoCreateRequestSchema,
	videoCreateToCanonical,
	toOpenAIVideoDeleted,
	toOpenAIVideoObject,
	toOpenAIVideoList,
} from "#contracts/openai/videos.ts";

import {
	markVideoDeletedForScope,
	markVideoAssetsDeleted,
	listVideosForScope,
	createVideoJob,
} from "#db/repos/videos.ts";

function virtualKeyId(c: Context<AppEnv>): string | null {
	const auth = getAuth(c);
	return auth.type === "virtual" ? auth.key.id : null;
}

function requireVideoId(c: Context<AppEnv>): string {
	const id = c.req.param("id");
	if (!id) {
		throw new GatewayError({
			class: "not_found",
			code: "video_not_found",
			message: "Video id is required",
		});
	}
	return id;
}

function ensureObjectStorageConfigured(): void {
	if (getObjectStore().backend === "disabled") {
		throw new GatewayError({
			class: "server",
			status: 503,
			code: "object_storage_not_configured",
			message: "Object storage is required for /v1/videos",
			publicMessage: "Object storage is not configured for video generation.",
		});
	}
}

function parseLimit(raw: string | undefined): number {
	if (raw === undefined) return 20;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 1 || value > 100) {
		throw new GatewayError({
			class: "bad_request",
			message: "limit must be an integer from 1 to 100",
			param: "limit",
		});
	}
	return value;
}

function parseOrder(raw: string | undefined): "asc" | "desc" {
	if (raw === undefined) return "desc";
	if (raw === "asc" || raw === "desc") return raw;
	throw new GatewayError({
		class: "bad_request",
		message: "order must be asc or desc",
		param: "order",
	});
}

function parseVariant(raw: string | undefined): VideoAssetVariant {
	if (raw === undefined) return "video";
	if (raw === "video" || raw === "thumbnail" || raw === "spritesheet")
		return raw;
	throw new GatewayError({
		class: "bad_request",
		message: "variant must be video, thumbnail, or spritesheet",
		param: "variant",
	});
}

function invalidRange(): GatewayError {
	return new GatewayError({
		class: "bad_request",
		code: "invalid_range",
		message: "Invalid Range header",
	});
}

function parseRange(raw: string | undefined): ObjectRange | undefined {
	if (!raw) return undefined;
	const match = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
	if (!match || (!match[1] && !match[2])) throw invalidRange();
	if (!match[1]) {
		// Suffix range (bytes=-N): the last N bytes; players use it to probe file tails.
		const suffix = Number(match[2]);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) throw invalidRange();
		return { suffix };
	}
	const start = Number(match[1]);
	const end = match[2] ? Number(match[2]) : undefined;
	if (!Number.isSafeInteger(start) || start < 0) throw invalidRange();
	if (end !== undefined && (!Number.isSafeInteger(end) || end < start))
		throw invalidRange();
	return end === undefined ? { start } : { start, end };
}

async function handleVideoCreate(
	c: Context<AppEnv>,
	req: CanonicalVideoRequest,
	requestBody: unknown,
): Promise<Response> {
	ensureObjectStorageConfigured();
	// Reference images arrive as multi-MB base64 data URLs; never persist those bytes.
	const storedRequest = sanitizeVideoRequestBody(requestBody) as Record<
		string,
		unknown
	>;
	const log = new OperationLogDraft(c, "videos.generations", {
		publicModel: req.model,
	});
	log.requestBody = storedRequest;
	let routing: RouteResult<CanonicalVideoProviderJob> | null = null;
	let submissionContext: AdapterContext | null = null;
	let persisted = false;
	let finished = false;
	const finish = async (error?: GatewayError | null): Promise<void> => {
		if (!routing || finished) return;
		finished = true;
		await routing.finish(
			null,
			undefined,
			error,
			error ? null : { outcome: "completed", reason: "stop", usage: null },
		);
	};

	try {
		await preflight(c, req.model);
		routing = await route(
			req.model,
			"videos.generations",
			{
				clientSignal: log.clientSignal,
				requestId: log.requestId,
				operationId: log.operationId,
				candidateEligibility: (candidate) =>
					assertVideoRequestSupported(req, candidate.meta),
				tokenReservation: (candidate) =>
					estimateTokenReservation(req, {
						maxOutputTokens: candidate.meta.maxOutputTokens ?? 0,
					}),
				usageQuota: usageQuotaForRequest(c),
			},
			(candidate, ctx) => {
				submissionContext = ctx;
				return candidate.adapter.videoGeneration!.submit(req, ctx);
			},
		);
		log.applyRouting(routing);
		log.upstreamTtftMs = Date.now() - routing.upstreamStartedAt;
		const usage = videoUsageToCore(routing.value.usage);

		const row = await createVideoJob({
			id: newVideoId(),
			virtualKeyId: virtualKeyId(c),
			publicModel: req.model,
			deploymentId: routing.candidate.row.id,
			adapterKey: routing.candidate.adapter.key,
			upstreamModel: routing.candidate.upstreamModel,
			upstreamJobId: routing.value.upstreamJobId,
			upstreamGenerationId: routing.value.upstreamGenerationId ?? null,
			upstreamPollingUrl: routing.value.upstreamPollingUrl ?? null,
			providerState: routing.value.providerState ?? {},
			request: storedRequest,
			prompt: req.prompt,
			seconds: req.seconds ?? null,
			size: req.size ?? null,
			quality: req.quality ?? null,
			status: routing.value.status,
			progress: routing.value.progress ?? 0,
			error: routing.value.error ?? null,
			usage: routing.value.usage ?? null,
			nextPollAt:
				routing.value.status === "completed" ||
				routing.value.status === "failed"
					? null
					: new Date(Date.now() + 1000),
		});
		persisted = true;
		await finish();
		const body = toOpenAIVideoObject(videoObjectFromRow(row));
		log.write({
			status: "success",
			httpStatus: 200,
			usage,
			cost: null,
			ttftMs: log.elapsedMs(),
			responseBody: body,
			metadata: {
				...candidateMetadata(routing.candidate),
				terminal: { outcome: "completed", reason: "stop", usage: null },
			},
			error: null,
		});
		return c.json(body);
	} catch (error) {
		const ge = toGatewayError(error);
		log.applyFailedAttempts(ge.attempts);
		if (routing && !persisted && submissionContext) {
			await routing.candidate.adapter.videoGeneration
				?.remove?.(
					{
						upstreamJobId: routing.value.upstreamJobId,
						upstreamGenerationId: routing.value.upstreamGenerationId ?? null,
						upstreamPollingUrl: routing.value.upstreamPollingUrl ?? null,
						providerState: routing.value.providerState ?? null,
					},
					submissionContext,
				)
				.catch((cleanupError: unknown) => {
					systemLog.warn(
						"videos",
						"failed to compensate an unpersisted video job",
						{
							err: cleanupError,
							requestId: log.requestId,
						},
					);
				});
		}
		await finish(ge);
		await notifyExtensionError(c, "videos.generations", log.publicModel, ge);
		log.writeError(ge);
		throw ge;
	}
}

export async function videoCreateHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const json = await readJsonBody(c, PUBLIC_JSON_BODY_MAX_BYTES);
	const data = parseBody(videoCreateRequestSchema, json);
	return handleVideoCreate(c, videoCreateToCanonical(data), data);
}

export async function videoRetrieveHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const id = requireVideoId(c);
	const row = await loadAndRefreshVideo(id, virtualKeyId(c), c.req.raw.signal);
	return c.json(toOpenAIVideoObject(videoObjectFromRow(row)));
}

export async function videoListHandler(c: Context<AppEnv>): Promise<Response> {
	const limit = parseLimit(c.req.query("limit"));
	const order = parseOrder(c.req.query("order"));
	const after = c.req.query("after");
	const { rows, hasMore } = await listVideosForScope({
		virtualKeyId: virtualKeyId(c),
		limit,
		order,
		...(after !== undefined ? { after } : {}),
	});
	return c.json({
		...toOpenAIVideoList({
			data: rows.map(videoObjectFromRow),
			hasMore,
		}),
	});
}

export async function videoDeleteHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const id = requireVideoId(c);
	const deleted = await markVideoDeletedForScope(id, virtualKeyId(c));
	if (!deleted.row) {
		throw new GatewayError({
			class: "not_found",
			code: "video_not_found",
			message: `Video ${id} not found`,
		});
	}
	const store = getObjectStore();
	const deletedAssetIds: string[] = [];
	for (const asset of deleted.assets) {
		try {
			await store.delete(asset.objectKey);
			deletedAssetIds.push(asset.id);
		} catch {
			// The row remains immediately expired so the background GC retries the object deletion.
		}
	}
	await markVideoAssetsDeleted(deletedAssetIds);
	await removeUpstreamVideo(deleted.row);
	return c.json(toOpenAIVideoDeleted(id));
}

export async function videoContentHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const id = requireVideoId(c);
	const variant = parseVariant(c.req.query("variant"));
	const row = await loadAndRefreshVideo(id, virtualKeyId(c), c.req.raw.signal);
	const asset = await ensureVideoAsset(row, variant, c.req.raw.signal);
	const stored = await readVideoAsset(asset, parseRange(c.req.header("range")));
	const headers = new Headers(storedContentHeaders(asset));
	headers.set("content-type", stored.contentType);
	headers.set("accept-ranges", "bytes");
	if (stored.range) {
		headers.set(
			"content-range",
			`bytes ${stored.range.start}-${stored.range.end}/${stored.range.total}`,
		);
		headers.set(
			"content-length",
			String(stored.range.end - stored.range.start + 1),
		);
		return new Response(stored.body, { status: 206, headers });
	}
	if (stored.contentLength !== undefined)
		headers.set("content-length", String(stored.contentLength));
	return new Response(stored.body, { status: 200, headers });
}
