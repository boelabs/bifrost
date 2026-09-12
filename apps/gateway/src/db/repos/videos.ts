import type { VideoAssetVariant, VideoStatus } from "#core/videos.ts";
import { videoAssets, videoJobs } from "#db/schema.ts";
import { env } from "#config/env.ts";
import { db } from "#db/client.ts";

import {
	inArray,
	isNull,
	desc,
	and,
	asc,
	lte,
	eq,
	gt,
	lt,
	or,
} from "drizzle-orm";

export type VideoJobRow = typeof videoJobs.$inferSelect;
export type VideoAssetRow = typeof videoAssets.$inferSelect;

export interface CreateVideoJobInput {
	id: string;
	virtualKeyId: string | null;
	publicModel: string;
	deploymentId: string;
	adapterKey: string;
	upstreamModel: string;
	upstreamJobId: string;
	upstreamGenerationId?: string | null;
	upstreamPollingUrl?: string | null;
	providerState?: Record<string, unknown>;
	request: Record<string, unknown>;
	prompt: string;
	seconds?: string | null;
	size?: string | null;
	quality?: string | null;
	status: VideoStatus;
	progress: number;
	error?: Record<string, unknown> | null;
	usage?: Record<string, unknown> | null;
	nextPollAt?: Date | null;
}

export interface StoreVideoAssetInput {
	videoId: string;
	variant: VideoAssetVariant;
	objectKey: string;
	storageBackend: string;
	contentType: string;
	contentLength?: number | null;
	etag?: string | null;
	sha256?: string | null;
	expiresAt: Date;
}

export function videoAssetExpiresAt(now = new Date()): Date {
	return new Date(
		now.getTime() + env.VIDEOS_ASSET_RETENTION_HOURS * 60 * 60 * 1000,
	);
}

/**
 * Virtual keys only see their own jobs. The master key (null scope) is the operator and sees
 * every job, so it gets no filter.
 */
function scopeCondition(virtualKeyId: string | null) {
	return virtualKeyId === null
		? undefined
		: eq(videoJobs.virtualKeyId, virtualKeyId);
}

export async function createVideoJob(
	input: CreateVideoJobInput,
): Promise<VideoJobRow> {
	const now = new Date();
	const [row] = await db
		.insert(videoJobs)
		.values({
			id: input.id,
			virtualKeyId: input.virtualKeyId,
			publicModel: input.publicModel,
			deploymentId: input.deploymentId,
			adapterKey: input.adapterKey,
			upstreamModel: input.upstreamModel,
			upstreamJobId: input.upstreamJobId,
			upstreamGenerationId: input.upstreamGenerationId ?? null,
			upstreamPollingUrl: input.upstreamPollingUrl ?? null,
			providerState: input.providerState ?? {},
			request: input.request,
			prompt: input.prompt,
			seconds: input.seconds ?? null,
			size: input.size ?? null,
			quality: input.quality ?? null,
			status: input.status,
			progress: input.progress,
			error: input.error ?? null,
			usage: input.usage ?? null,
			expiresAt: videoAssetExpiresAt(now),
			nextPollAt: input.nextPollAt ?? null,
		})
		.returning();
	return row!;
}

export async function getVideoJobForScope(
	id: string,
	virtualKeyId: string | null,
	opts: { includeDeleted?: boolean } = {},
): Promise<VideoJobRow | undefined> {
	const conditions = [eq(videoJobs.id, id), scopeCondition(virtualKeyId)];
	if (!opts.includeDeleted) conditions.push(isNull(videoJobs.deletedAt));
	const [row] = await db
		.select()
		.from(videoJobs)
		.where(and(...conditions))
		.limit(1);
	return row;
}

export async function getVideoJobById(
	id: string,
): Promise<VideoJobRow | undefined> {
	const [row] = await db
		.select()
		.from(videoJobs)
		.where(eq(videoJobs.id, id))
		.limit(1);
	return row;
}

export async function listVideosForScope(opts: {
	virtualKeyId: string | null;
	limit: number;
	after?: string;
	order: "asc" | "desc";
}): Promise<{ rows: VideoJobRow[]; hasMore: boolean }> {
	const conditions = [
		scopeCondition(opts.virtualKeyId),
		isNull(videoJobs.deletedAt),
	];
	if (opts.after) {
		const after = await getVideoJobForScope(opts.after, opts.virtualKeyId);
		if (after) {
			// (createdAt, id) tuple comparison so createdAt ties cannot skip rows.
			conditions.push(
				opts.order === "asc"
					? or(
							gt(videoJobs.createdAt, after.createdAt),
							and(
								eq(videoJobs.createdAt, after.createdAt),
								gt(videoJobs.id, after.id),
							),
						)
					: or(
							lt(videoJobs.createdAt, after.createdAt),
							and(
								eq(videoJobs.createdAt, after.createdAt),
								lt(videoJobs.id, after.id),
							),
						),
			);
		}
	}
	const rows = await db
		.select()
		.from(videoJobs)
		.where(and(...conditions))
		.orderBy(
			...(opts.order === "asc"
				? [asc(videoJobs.createdAt), asc(videoJobs.id)]
				: [desc(videoJobs.createdAt), desc(videoJobs.id)]),
		)
		.limit(opts.limit + 1);
	return { rows: rows.slice(0, opts.limit), hasMore: rows.length > opts.limit };
}

export async function updateVideoJobState(
	id: string,
	patch: {
		status: VideoStatus;
		progress: number;
		error?: Record<string, unknown> | null;
		usage?: Record<string, unknown> | null;
		upstreamGenerationId?: string | null;
		upstreamPollingUrl?: string | null;
		providerState?: Record<string, unknown>;
		completedAt?: Date | null;
		nextPollAt?: Date | null;
		lastPolledAt?: Date | null;
	},
): Promise<VideoJobRow | undefined> {
	const [row] = await db
		.update(videoJobs)
		.set({
			status: patch.status,
			progress: patch.progress,
			...(patch.error !== undefined ? { error: patch.error } : {}),
			...(patch.usage !== undefined ? { usage: patch.usage } : {}),
			updatedAt: new Date(),
			...(patch.upstreamGenerationId !== undefined
				? { upstreamGenerationId: patch.upstreamGenerationId }
				: {}),
			...(patch.upstreamPollingUrl !== undefined
				? { upstreamPollingUrl: patch.upstreamPollingUrl }
				: {}),
			...(patch.providerState !== undefined
				? { providerState: patch.providerState }
				: {}),
			...(patch.completedAt !== undefined
				? { completedAt: patch.completedAt }
				: {}),
			...(patch.nextPollAt !== undefined
				? { nextPollAt: patch.nextPollAt }
				: {}),
			...(patch.lastPolledAt !== undefined
				? { lastPolledAt: patch.lastPolledAt }
				: {}),
		})
		.where(eq(videoJobs.id, id))
		.returning();
	return row;
}

export async function storeVideoAsset(
	input: StoreVideoAssetInput,
): Promise<VideoAssetRow> {
	const [row] = await db
		.insert(videoAssets)
		.values({
			videoId: input.videoId,
			variant: input.variant,
			objectKey: input.objectKey,
			storageBackend: input.storageBackend,
			contentType: input.contentType,
			contentLength: input.contentLength ?? null,
			etag: input.etag ?? null,
			sha256: input.sha256 ?? null,
			expiresAt: input.expiresAt,
			deletedAt: null,
		})
		.onConflictDoUpdate({
			target: [videoAssets.videoId, videoAssets.variant],
			set: {
				objectKey: input.objectKey,
				storageBackend: input.storageBackend,
				contentType: input.contentType,
				contentLength: input.contentLength ?? null,
				etag: input.etag ?? null,
				sha256: input.sha256 ?? null,
				expiresAt: input.expiresAt,
				deletedAt: null,
			},
		})
		.returning();
	return row!;
}

export async function getVideoAsset(
	videoId: string,
	variant: VideoAssetVariant,
	now = new Date(),
): Promise<VideoAssetRow | undefined> {
	const [row] = await db
		.select()
		.from(videoAssets)
		.where(
			and(
				eq(videoAssets.videoId, videoId),
				eq(videoAssets.variant, variant),
				isNull(videoAssets.deletedAt),
				gt(videoAssets.expiresAt, now),
			),
		)
		.limit(1);
	return row;
}

export async function markVideoDeletedForScope(
	id: string,
	virtualKeyId: string | null,
): Promise<{ row: VideoJobRow | undefined; assets: VideoAssetRow[] }> {
	return db.transaction(async (tx) => {
		const now = new Date();
		const [row] = await tx
			.update(videoJobs)
			.set({ status: "deleted", deletedAt: now, updatedAt: now })
			.where(
				and(
					eq(videoJobs.id, id),
					scopeCondition(virtualKeyId),
					isNull(videoJobs.deletedAt),
				),
			)
			.returning();
		if (!row) return { row: undefined, assets: [] };
		const assets = await tx
			.update(videoAssets)
			// Make every object immediately eligible for the retrying GC. The endpoint marks only
			// successfully removed objects as deleted, so a storage outage cannot orphan data forever.
			.set({ expiresAt: now })
			.where(and(eq(videoAssets.videoId, id), isNull(videoAssets.deletedAt)))
			.returning();
		return { row, assets };
	});
}

export async function listExpiredVideoAssets(
	now = new Date(),
	limit = 100,
): Promise<VideoAssetRow[]> {
	return db
		.select()
		.from(videoAssets)
		.where(and(isNull(videoAssets.deletedAt), lte(videoAssets.expiresAt, now)))
		.limit(limit);
}

export async function markVideoAssetsDeleted(ids: string[]): Promise<void> {
	if (ids.length === 0) return;
	await db
		.update(videoAssets)
		.set({ deletedAt: new Date() })
		.where(inArray(videoAssets.id, ids));
}

/**
 * Atomically claims a batch of due jobs by pushing their nextPollAt one interval into the
 * future. FOR UPDATE SKIP LOCKED plus the claim window keep concurrent pollers (other gateway
 * instances, an overlapping tick, or a request-path refresh) from double-polling the same job;
 * if a claimer dies mid-refresh the job simply becomes due again.
 */
export async function claimDueVideoJobs(
	now = new Date(),
	limit = env.VIDEO_JOB_POLL_BATCH_SIZE,
	claimMs = env.VIDEO_JOB_POLL_INTERVAL_MS,
): Promise<VideoJobRow[]> {
	return db.transaction(async (tx) => {
		const due = await tx
			.select({ id: videoJobs.id })
			.from(videoJobs)
			.where(
				and(
					inArray(videoJobs.status, ["queued", "in_progress"]),
					isNull(videoJobs.deletedAt),
					or(isNull(videoJobs.nextPollAt), lte(videoJobs.nextPollAt, now)),
				),
			)
			.orderBy(asc(videoJobs.createdAt))
			.limit(limit)
			.for("update", { skipLocked: true });
		if (due.length === 0) return [];
		return tx
			.update(videoJobs)
			.set({ nextPollAt: new Date(now.getTime() + claimMs) })
			.where(
				inArray(
					videoJobs.id,
					due.map((row) => row.id),
				),
			)
			.returning();
	});
}
