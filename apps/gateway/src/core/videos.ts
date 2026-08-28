import type { Usage } from "./usage.ts";

export type VideoStatus = "queued" | "in_progress" | "completed" | "failed";
export type VideoAssetVariant = "video" | "thumbnail" | "spritesheet";
export type VideoQuality = "auto" | "low" | "medium" | "high" | "native";

export const VIDEO_ASPECT_RATIOS = [
	"16:9",
	"9:16",
	"1:1",
	"4:3",
	"3:4",
	"3:2",
	"2:3",
	"21:9",
	"9:21",
] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export const VIDEO_RESOLUTIONS = [
	"480p",
	"720p",
	"1080p",
	"1K",
	"2K",
	"4K",
] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export type VideoUrlReferenceType = "image_url" | "audio_url" | "video_url";

export interface VideoUrlReference {
	type: VideoUrlReferenceType;
	url: string;
}

export interface VideoFileReference {
	type: "file_id";
	fileId: string;
}

export type VideoInputReference = VideoUrlReference | VideoFileReference;

export interface VideoFrameImage {
	frame: "first" | "last";
	url: string;
}

export interface CanonicalVideoRequest {
	model: string;
	prompt: string;
	/** Guiding assets. Image references are broadly supported; audio/video only by some providers. */
	inputReferences?: VideoInputReference[];
	/** First/last frame images for providers that support frame conditioning. */
	frameImages?: VideoFrameImage[];
	/** Duration as a seconds string ("8"). Fed by either `seconds` or `duration` on the wire. */
	seconds?: string;
	/** Exact pixel dimensions, WIDTHxHEIGHT. Interchangeable with aspectRatio + resolution. */
	size?: string;
	aspectRatio?: VideoAspectRatio;
	resolution?: VideoResolution;
	seed?: number;
	generateAudio?: boolean;
	quality?: VideoQuality;
	/** Gateway-side attribution only. Never forwarded upstream. */
	user?: string;
	extraBody?: Record<string, unknown>;
}

export interface VideoSizeMapping {
	/** Native exact size when the provider accepts WIDTHxHEIGHT. */
	size?: string;
	/** Native aspect-ratio value, e.g. 16:9. */
	aspectRatio?: string;
	/** Native resolution value, e.g. 720p or 1080p. */
	resolution?: string;
}

export interface VideoModelProfile {
	maxPromptChars?: number;
	/** Accepted public durations, represented as seconds strings. */
	durations?: string[];
	qualities?: VideoQuality[];
	sizes?: Record<string, VideoSizeMapping>;
	supportsImageUrl?: boolean;
	supportsAudioUrl?: boolean;
	supportsVideoUrl?: boolean;
	supportsFileId?: boolean;
	supportsFrameImages?: boolean;
	supportsSeed?: boolean;
	supportsGenerateAudio?: boolean;
	maxInputReferences?: number;
	/** Require data:image/... URLs when the adapter cannot ingest remote URLs itself. */
	requiresDataUrlImageReference?: boolean;
	maxReferenceBytes?: number;
	/** Variants the provider/gateway can serve without fabricating assets. */
	contentVariants?: VideoAssetVariant[];
	/** How often the gateway should poll an unfinished job for this model. */
	pollIntervalSeconds?: number;
}

/** The provider-facing dimensions resolved from `size` or `aspectRatio`/`resolution` via the profile. */
export interface ResolvedVideoSize {
	/** Exact WIDTHxHEIGHT for providers that take pixel dimensions. */
	size?: string;
	aspectRatio?: string;
	resolution?: string;
}

/**
 * Resolves the requested dimensions against the profile's size table. `size` keys the table
 * directly; `aspectRatio`/`resolution` reverse-match a table entry so exact-size providers still
 * get WIDTHxHEIGHT. Returns undefined when nothing was requested.
 */
export function resolveVideoSize(
	req: Pick<CanonicalVideoRequest, "size" | "aspectRatio" | "resolution">,
	profile: VideoModelProfile | undefined,
): ResolvedVideoSize | undefined {
	if (req.size) {
		const mapping = profile?.sizes?.[req.size];
		return {
			size: mapping?.size ?? req.size,
			...(mapping?.aspectRatio ? { aspectRatio: mapping.aspectRatio } : {}),
			...(mapping?.resolution ? { resolution: mapping.resolution } : {}),
		};
	}
	if (!req.aspectRatio && !req.resolution) return undefined;
	const requestedResolution = req.resolution?.toLowerCase();
	const match = Object.entries(profile?.sizes ?? {}).find(
		([, mapping]) =>
			(!req.aspectRatio || mapping.aspectRatio === req.aspectRatio) &&
			(!requestedResolution ||
				mapping.resolution?.toLowerCase() === requestedResolution),
	);
	if (!match) {
		return {
			...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
			...(req.resolution ? { resolution: req.resolution } : {}),
		};
	}
	const [key, mapping] = match;
	const aspectRatio = req.aspectRatio ?? mapping.aspectRatio;
	const resolution = mapping.resolution ?? req.resolution;
	return {
		size: mapping.size ?? key,
		...(aspectRatio !== undefined ? { aspectRatio } : {}),
		...(resolution !== undefined ? { resolution } : {}),
	};
}

export interface CanonicalVideoProviderJob {
	upstreamJobId: string;
	upstreamGenerationId?: string;
	upstreamPollingUrl?: string;
	status: VideoStatus;
	progress?: number;
	error?: {
		code?: string | null;
		message: string;
	};
	usage?: Record<string, unknown>;
	providerState?: Record<string, unknown>;
}

export interface CanonicalVideoContent {
	body: ReadableStream<Uint8Array>;
	contentType: string;
	contentLength?: number;
}

export interface CanonicalVideoObject {
	id: string;
	model: string;
	status: VideoStatus;
	progress: number;
	prompt: string;
	seconds?: string;
	size?: string;
	quality?: VideoQuality;
	createdAt: Date;
	completedAt?: Date | null;
	expiresAt?: Date | null;
	error?: {
		code?: string | null;
		message: string;
	} | null;
	remixedFromVideoId?: string | null;
}

const DATA_URL_REDACTION_THRESHOLD = 1024;

function redactedDataUrl(value: string): string {
	const header = value.slice(0, value.indexOf(",") + 1);
	return `${header}[redacted ${value.length - header.length} chars]`;
}

/**
 * Replaces large base64 data URLs (reference images can be tens of MB) before the request body
 * is persisted to video_jobs.request or operation metadata.
 */
export function sanitizeVideoRequestBody(value: unknown, depth = 0): unknown {
	if (typeof value === "string") {
		return value.startsWith("data:") &&
			value.length > DATA_URL_REDACTION_THRESHOLD
			? redactedDataUrl(value)
			: value;
	}
	if (depth >= 6 || value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeVideoRequestBody(item, depth + 1));
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, item]) => [
			key,
			sanitizeVideoRequestBody(item, depth + 1),
		]),
	);
}

export function videoUsageToCore(
	_usage: Record<string, unknown> | undefined,
): Usage | null {
	// Video providers report cost/media units in provider-specific forms. Keep them in video_jobs
	// metadata until the billing subsystem grows first-class media units.
	return null;
}
