import { GatewayError } from "#core/errors.ts";
import * as z from "zod/v4";

import type {
	CanonicalImageStreamEvent,
	CanonicalImageResponse,
	CanonicalImageRequest,
	ImageUsage,
} from "#core/images.ts";

const extraBodySchema = z.record(z.string(), z.unknown());
const sizeSchema = z
	.string()
	.regex(/^(?:auto|[1-9]\d*x[1-9]\d*)$/, "must be 'auto' or WIDTHxHEIGHT");

export const imageGenerationRequestSchema = z
	.object({
		model: z.string().min(1),
		prompt: z.string().min(1).max(32_000),
		background: z.enum(["transparent", "opaque", "auto"]).nullable().optional(),
		moderation: z.enum(["low", "auto"]).nullable().optional(),
		n: z.int().min(1).max(10).nullable().optional(),
		output_compression: z.int().min(0).max(100).nullable().optional(),
		output_format: z.enum(["png", "jpeg", "webp"]).nullable().optional(),
		partial_images: z.int().min(0).max(3).nullable().optional(),
		quality: z
			.enum(["standard", "hd", "low", "medium", "high", "auto"])
			.nullable()
			.optional(),
		response_format: z.literal("b64_json").nullable().optional(),
		size: sizeSchema.nullable().optional(),
		stream: z.boolean().nullable().optional().default(false),
		style: z.enum(["vivid", "natural"]).nullable().optional(),
		user: z.string().nullable().optional(),
		extra_body: extraBodySchema.optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.partial_images != null && !value.stream) {
			ctx.addIssue({
				code: "custom",
				path: ["partial_images"],
				message: "requires stream=true",
			});
		}
		if (
			value.output_compression != null &&
			!["jpeg", "webp"].includes(value.output_format ?? "png")
		) {
			ctx.addIssue({
				code: "custom",
				path: ["output_compression"],
				message: "requires output_format jpeg or webp",
			});
		}
		if (value.background === "transparent" && value.output_format === "jpeg") {
			ctx.addIssue({
				code: "custom",
				path: ["background"],
				message: "transparent output requires png or webp",
			});
		}
	});

export type ImageGenerationRequest = z.infer<
	typeof imageGenerationRequestSchema
>;

export const imageEditFieldsSchema = z
	.object({
		model: z.string().min(1),
		prompt: z.string().min(1).max(32_000),
		background: z.enum(["transparent", "opaque", "auto"]).nullable().optional(),
		input_fidelity: z.enum(["high", "low"]).nullable().optional(),
		n: z.int().min(1).max(10).nullable().optional(),
		output_compression: z.int().min(0).max(100).nullable().optional(),
		output_format: z.enum(["png", "jpeg", "webp"]).nullable().optional(),
		partial_images: z.int().min(0).max(3).nullable().optional(),
		quality: z
			.enum(["standard", "low", "medium", "high", "auto"])
			.nullable()
			.optional(),
		response_format: z.literal("b64_json").nullable().optional(),
		size: sizeSchema.nullable().optional(),
		stream: z.boolean().nullable().optional().default(false),
		user: z.string().nullable().optional(),
		extra_body: extraBodySchema.optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (value.partial_images != null && !value.stream) {
			ctx.addIssue({
				code: "custom",
				path: ["partial_images"],
				message: "requires stream=true",
			});
		}
		if (
			value.output_compression != null &&
			!["jpeg", "webp"].includes(value.output_format ?? "png")
		) {
			ctx.addIssue({
				code: "custom",
				path: ["output_compression"],
				message: "requires output_format jpeg or webp",
			});
		}
		if (value.background === "transparent" && value.output_format === "jpeg") {
			ctx.addIssue({
				code: "custom",
				path: ["background"],
				message: "transparent output requires png or webp",
			});
		}
	});

export type ImageEditFields = z.infer<typeof imageEditFieldsSchema>;

function defined<T>(value: T | null | undefined): T | undefined {
	return value == null ? undefined : value;
}

export function generationToCanonical(
	req: ImageGenerationRequest,
): CanonicalImageRequest {
	return {
		operation: "generation",
		model: req.model,
		prompt: req.prompt,
		stream: req.stream ?? false,
		...(defined(req.background) !== undefined
			? { background: defined(req.background) }
			: {}),
		...(defined(req.moderation) !== undefined
			? { moderation: defined(req.moderation) }
			: {}),
		...(defined(req.n) !== undefined ? { n: defined(req.n) } : {}),
		...(defined(req.output_compression) !== undefined
			? { outputCompression: defined(req.output_compression) }
			: {}),
		...(defined(req.output_format) !== undefined
			? { outputFormat: defined(req.output_format) }
			: {}),
		...(defined(req.partial_images) !== undefined
			? { partialImages: defined(req.partial_images) }
			: {}),
		...(defined(req.quality) !== undefined
			? { quality: defined(req.quality) }
			: {}),
		responseFormat: "b64_json",
		...(defined(req.size) !== undefined ? { size: defined(req.size) } : {}),
		...(defined(req.style) !== undefined ? { style: defined(req.style) } : {}),
		...(defined(req.user) !== undefined ? { user: defined(req.user) } : {}),
		...(req.extra_body !== undefined ? { extraBody: req.extra_body } : {}),
	} as CanonicalImageRequest;
}

export function editToCanonical(
	req: ImageEditFields,
	images: CanonicalImageRequest["images"],
	mask?: CanonicalImageRequest["mask"],
): CanonicalImageRequest {
	return {
		operation: "edit",
		model: req.model,
		prompt: req.prompt,
		images,
		...(mask ? { mask } : {}),
		stream: req.stream ?? false,
		...(defined(req.background) !== undefined
			? { background: defined(req.background) }
			: {}),
		...(defined(req.input_fidelity) !== undefined
			? { inputFidelity: defined(req.input_fidelity) }
			: {}),
		...(defined(req.n) !== undefined ? { n: defined(req.n) } : {}),
		...(defined(req.output_compression) !== undefined
			? { outputCompression: defined(req.output_compression) }
			: {}),
		...(defined(req.output_format) !== undefined
			? { outputFormat: defined(req.output_format) }
			: {}),
		...(defined(req.partial_images) !== undefined
			? { partialImages: defined(req.partial_images) }
			: {}),
		...(defined(req.quality) !== undefined
			? { quality: defined(req.quality) }
			: {}),
		responseFormat: "b64_json",
		...(defined(req.size) !== undefined ? { size: defined(req.size) } : {}),
		...(defined(req.user) !== undefined ? { user: defined(req.user) } : {}),
		...(req.extra_body !== undefined ? { extraBody: req.extra_body } : {}),
	} as CanonicalImageRequest;
}

function publicUsage(
	usage: ImageUsage | undefined,
): Record<string, unknown> | undefined {
	if (!usage) return undefined;
	return {
		input_tokens: usage.inputTokens,
		output_tokens: usage.outputTokens,
		total_tokens: usage.totalTokens,
		input_tokens_details: {
			image_tokens: usage.inputImageTokens ?? 0,
			text_tokens: usage.inputTextTokens ?? 0,
		},
		...(usage.outputImageTokens !== undefined ||
		usage.outputTextTokens !== undefined
			? {
					output_tokens_details: {
						image_tokens: usage.outputImageTokens ?? 0,
						text_tokens: usage.outputTextTokens ?? 0,
					},
				}
			: {}),
	};
}

export function toOpenAIImagesResponse(
	response: CanonicalImageResponse,
): Record<string, unknown> {
	return {
		created: response.created,
		data: response.data.map((image) => {
			if (!image.b64Json) {
				throw new GatewayError({
					class: "server",
					message: "Image response is missing b64_json",
				});
			}
			return {
				b64_json: image.b64Json,
				...(image.revisedPrompt !== undefined
					? { revised_prompt: image.revisedPrompt }
					: {}),
			};
		}),
		...(response.background !== undefined && response.background !== "auto"
			? { background: response.background }
			: {}),
		...(response.outputFormat !== undefined
			? { output_format: response.outputFormat }
			: {}),
		...(response.quality !== undefined &&
		!["auto", "standard", "hd"].includes(response.quality)
			? { quality: response.quality }
			: {}),
		...(response.size !== undefined && response.size !== "auto"
			? { size: response.size }
			: {}),
		...(response.usage !== undefined
			? { usage: publicUsage(response.usage) }
			: {}),
	};
}

export function toOpenAIImageEvent(
	event: CanonicalImageStreamEvent,
): Record<string, unknown> {
	if (!event.image.b64Json) {
		throw new GatewayError({
			class: "server",
			message: "Streaming image event is missing b64_json",
		});
	}
	const prefix =
		event.operation === "generation" ? "image_generation" : "image_edit";
	return {
		type: `${prefix}.${event.kind === "partial" ? "partial_image" : "completed"}`,
		b64_json: event.image.b64Json,
		created_at: event.createdAt,
		background: event.background ?? "auto",
		output_format: event.outputFormat ?? "png",
		quality: event.quality ?? "auto",
		size: event.size ?? "auto",
		...(event.kind === "partial"
			? { partial_image_index: event.partialImageIndex }
			: {}),
		...(event.kind === "completed" && event.usage
			? { usage: publicUsage(event.usage) }
			: {}),
	};
}
