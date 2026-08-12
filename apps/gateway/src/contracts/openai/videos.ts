import * as z from "zod/v4";

import {
	type CanonicalVideoRequest,
	type CanonicalVideoObject,
	type VideoInputReference,
	type VideoFrameImage,
	VIDEO_ASPECT_RATIOS,
	VIDEO_RESOLUTIONS,
} from "#core/videos.ts";

/**
 * Public request contract for POST /v1/videos. There is no industry standard for this endpoint,
 * so the gateway defines its own surface (duration, aspect_ratio, resolution, seed,
 * generate_audio, input_references, frame_images) while staying accept-compatible with OpenAI's
 * Sora request shape (seconds, input_reference). `quality` and `user` are gateway extensions:
 * quality is forwarded only when the model profile declares it, user is never forwarded
 * upstream. Provider-specific passthrough goes through extra_body.
 */

const extraBodySchema = z.record(z.string(), z.unknown());
const sizeSchema = z
	.string()
	.regex(/^[1-9]\d*x[1-9]\d*$/, "must be WIDTHxHEIGHT");
const secondsSchema = z.union([z.string().min(1), z.number().int().positive()]);

const urlObjectSchema = z.object({ url: z.string().min(1) }).strict();

const contentPartImageSchema = z
	.object({ type: z.literal("image_url"), image_url: urlObjectSchema })
	.strict();
const contentPartAudioSchema = z
	.object({ type: z.literal("audio_url"), audio_url: urlObjectSchema })
	.strict();
const contentPartVideoSchema = z
	.object({ type: z.literal("video_url"), video_url: urlObjectSchema })
	.strict();

export const videoInputReferencesSchema = z.array(
	z.discriminatedUnion("type", [
		contentPartImageSchema,
		contentPartAudioSchema,
		contentPartVideoSchema,
	]),
);

export const videoFrameImagesSchema = z.array(
	z
		.object({
			type: z.literal("image_url"),
			image_url: urlObjectSchema,
			frame_type: z.enum(["first_frame", "last_frame"]),
		})
		.strict(),
);

// OpenAI Sora compatibility: single reference, image_url as bare string or {url}, or a file_id.
const imageReferenceSchema = z.union([z.string().min(1), urlObjectSchema]);

export const videoInputReferenceSchema = z
	.object({
		image_url: imageReferenceSchema.optional(),
		file_id: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		const count =
			(value.image_url !== undefined ? 1 : 0) +
			(value.file_id !== undefined ? 1 : 0);
		if (count !== 1) {
			ctx.addIssue({
				code: "custom",
				message: "must contain exactly one of image_url or file_id",
			});
		}
	});

export const videoCreateRequestSchema = z
	.object({
		model: z.string().min(1),
		prompt: z.string().min(1).max(32_000),
		input_reference: videoInputReferenceSchema.nullable().optional(),
		input_references: videoInputReferencesSchema.nullable().optional(),
		frame_images: videoFrameImagesSchema.nullable().optional(),
		seconds: secondsSchema.nullable().optional(),
		duration: z.number().int().positive().nullable().optional(),
		size: sizeSchema.nullable().optional(),
		aspect_ratio: z.enum(VIDEO_ASPECT_RATIOS).nullable().optional(),
		resolution: z.enum(VIDEO_RESOLUTIONS).nullable().optional(),
		seed: z.number().int().nullable().optional(),
		generate_audio: z.boolean().nullable().optional(),
		quality: z
			.enum(["standard", "hd", "low", "medium", "high", "auto"])
			.nullable()
			.optional(),
		user: z.string().nullable().optional(),
		extra_body: extraBodySchema.optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.seconds != null && value.duration != null) {
			ctx.addIssue({
				code: "custom",
				path: ["duration"],
				message: "provide either seconds or duration, not both",
			});
		}
		if (value.input_reference != null && value.input_references != null) {
			ctx.addIssue({
				code: "custom",
				path: ["input_references"],
				message: "provide either input_reference or input_references, not both",
			});
		}
		if (value.size != null && (value.aspect_ratio || value.resolution)) {
			ctx.addIssue({
				code: "custom",
				path: ["size"],
				message:
					"size is interchangeable with aspect_ratio/resolution; provide one form",
			});
		}
	});

export type VideoCreateRequest = z.infer<typeof videoCreateRequestSchema>;

function defined<T>(value: T | null | undefined): T | undefined {
	return value == null ? undefined : value;
}

function inputReferencesToCanonical(
	req: VideoCreateRequest,
): VideoInputReference[] | undefined {
	if (req.input_references != null) {
		return req.input_references.map((part): VideoInputReference => {
			if (part.type === "image_url")
				return { type: "image_url", url: part.image_url.url };
			if (part.type === "audio_url")
				return { type: "audio_url", url: part.audio_url.url };
			return { type: "video_url", url: part.video_url.url };
		});
	}
	const single = req.input_reference;
	if (single == null) return undefined;
	if (single.file_id !== undefined)
		return [{ type: "file_id", fileId: single.file_id }];
	const image = single.image_url;
	if (typeof image === "string") return [{ type: "image_url", url: image }];
	if (image?.url !== undefined) return [{ type: "image_url", url: image.url }];
	return undefined;
}

function frameImagesToCanonical(
	req: VideoCreateRequest,
): VideoFrameImage[] | undefined {
	if (req.frame_images == null) return undefined;
	return req.frame_images.map((frame) => ({
		frame: frame.frame_type === "first_frame" ? "first" : "last",
		url: frame.image_url.url,
	}));
}

export function videoCreateToCanonical(
	req: VideoCreateRequest,
): CanonicalVideoRequest {
	const canonical: CanonicalVideoRequest = {
		model: req.model,
		prompt: req.prompt,
	};
	const inputReferences = inputReferencesToCanonical(req);
	if (inputReferences !== undefined && inputReferences.length > 0)
		canonical.inputReferences = inputReferences;
	const frameImages = frameImagesToCanonical(req);
	if (frameImages !== undefined && frameImages.length > 0)
		canonical.frameImages = frameImages;
	const seconds = defined(req.seconds) ?? defined(req.duration);
	if (seconds !== undefined) canonical.seconds = String(seconds);
	const size = defined(req.size);
	if (size !== undefined) canonical.size = size;
	const aspectRatio = defined(req.aspect_ratio);
	if (aspectRatio !== undefined) canonical.aspectRatio = aspectRatio;
	const resolution = defined(req.resolution);
	if (resolution !== undefined) canonical.resolution = resolution;
	const seed = defined(req.seed);
	if (seed !== undefined) canonical.seed = seed;
	const generateAudio = defined(req.generate_audio);
	if (generateAudio !== undefined) canonical.generateAudio = generateAudio;
	const quality = defined(req.quality);
	if (quality !== undefined) canonical.quality = quality;
	const user = defined(req.user);
	if (user !== undefined) canonical.user = user;
	if (req.extra_body !== undefined) canonical.extraBody = req.extra_body;
	return canonical;
}

function unixSeconds(value: Date | null | undefined): number | null {
	return value ? Math.floor(value.getTime() / 1000) : null;
}

export function toOpenAIVideoObject(
	video: CanonicalVideoObject,
): Record<string, unknown> {
	return {
		id: video.id,
		object: "video",
		created_at: Math.floor(video.createdAt.getTime() / 1000),
		completed_at: unixSeconds(video.completedAt),
		expires_at: unixSeconds(video.expiresAt),
		model: video.model,
		status: video.status,
		progress: video.progress,
		prompt: video.prompt,
		error: video.error ?? null,
		remixed_from_video_id: video.remixedFromVideoId ?? null,
		...(video.seconds !== undefined ? { seconds: video.seconds } : {}),
		...(video.size !== undefined ? { size: video.size } : {}),
		...(video.quality !== undefined ? { quality: video.quality } : {}),
	};
}

export function toOpenAIVideoList(opts: {
	data: CanonicalVideoObject[];
	hasMore: boolean;
}): Record<string, unknown> {
	return {
		object: "list",
		data: opts.data.map(toOpenAIVideoObject),
		first_id: opts.data[0]?.id ?? null,
		last_id: opts.data.at(-1)?.id ?? null,
		has_more: opts.hasMore,
	};
}

export function toOpenAIVideoDeleted(id: string): Record<string, unknown> {
	return { id, object: "video.deleted", deleted: true };
}
