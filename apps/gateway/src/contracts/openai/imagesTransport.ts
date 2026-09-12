import type { ImageModelProfile } from "#core/images.ts";
import { mergeExtraBodyDeep } from "#core/extraBody.ts";
import { GatewayError } from "#core/errors.ts";
import { readFile } from "node:fs/promises";
import { parseSSE } from "#core/sse.ts";
import { openAsBlob } from "node:fs";

import {
	type CanonicalImageStreamEvent,
	type CanonicalImageResponse,
	type CanonicalImageRequest,
	type CanonicalImageData,
	type ImageOutputFormat,
	type ImageBackground,
	type ImageQuality,
	resolveImageSize,
	type ImageUsage,
} from "#core/images.ts";

const DIRECT_MANAGED = [
	"model",
	"prompt",
	"background",
	"input_fidelity",
	"mask",
	"moderation",
	"n",
	"output_compression",
	"output_format",
	"partial_images",
	"quality",
	"response_format",
	"size",
	"stream",
	"style",
	"user",
	"image",
	"image[]",
] as const;

function directBody(
	req: CanonicalImageRequest,
	upstreamModel: string,
	profile?: ImageModelProfile,
): Record<string, unknown> {
	const localOutputFormat = profile?.nativeOutputFormat === false;
	const localOutputCompression = profile?.nativeOutputCompression === false;
	const resolvedSize = resolveImageSize(req, profile);
	const body: Record<string, unknown> = {
		model: upstreamModel,
		prompt: req.prompt,
		...(req.background !== undefined ? { background: req.background } : {}),
		...(req.inputFidelity !== undefined
			? { input_fidelity: req.inputFidelity }
			: {}),
		...(req.moderation !== undefined ? { moderation: req.moderation } : {}),
		...(req.n !== undefined ? { n: req.n } : {}),
		...(req.outputCompression !== undefined && !localOutputCompression
			? { output_compression: req.outputCompression }
			: {}),
		...(req.outputFormat !== undefined && !localOutputFormat
			? { output_format: req.outputFormat }
			: {}),
		...(req.partialImages !== undefined && profile?.supportsNativeStreaming
			? { partial_images: req.partialImages }
			: {}),
		...(req.quality !== undefined ? { quality: req.quality } : {}),
		response_format: "b64_json",
		...(resolvedSize?.size !== undefined ? { size: resolvedSize.size } : {}),
		...(req.stream && profile?.supportsNativeStreaming ? { stream: true } : {}),
		...(req.style !== undefined ? { style: req.style } : {}),
		...(req.user !== undefined ? { user: req.user } : {}),
	};
	return mergeExtraBodyDeep(body, req.extraBody, DIRECT_MANAGED);
}

export function buildDirectImageGenerationBody(
	req: CanonicalImageRequest,
	upstreamModel: string,
	profile?: ImageModelProfile,
): Record<string, unknown> {
	return directBody(req, upstreamModel, profile);
}

function formValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return JSON.stringify(value);
}

export async function buildDirectImageEditForm(
	req: CanonicalImageRequest,
	upstreamModel: string,
	profile?: ImageModelProfile,
): Promise<FormData> {
	const body = directBody(req, upstreamModel, profile);
	const form = new FormData();
	for (const [key, value] of Object.entries(body))
		form.append(key, formValue(value));
	const images = req.images ?? [];
	const field = images.length > 1 ? "image[]" : "image";
	for (const image of images) {
		const blob = await openAsBlob(image.path, { type: image.mimeType });
		form.append(field, blob, image.filename);
	}
	if (req.mask) {
		const blob = await openAsBlob(req.mask.path, { type: req.mask.mimeType });
		form.append("mask", blob, req.mask.filename);
	}
	return form;
}

function imageUsage(raw: unknown): ImageUsage | undefined {
	const u = raw as
		| {
				input_tokens?: number;
				output_tokens?: number;
				total_tokens?: number;
				input_tokens_details?: { image_tokens?: number; text_tokens?: number };
				output_tokens_details?: { image_tokens?: number; text_tokens?: number };
		  }
		| undefined;
	if (!u || typeof u.total_tokens !== "number") return undefined;
	return {
		inputTokens: u.input_tokens ?? 0,
		outputTokens: u.output_tokens ?? 0,
		totalTokens: u.total_tokens,
		...(u.input_tokens_details?.image_tokens !== undefined
			? { inputImageTokens: u.input_tokens_details.image_tokens }
			: {}),
		...(u.input_tokens_details?.text_tokens !== undefined
			? { inputTextTokens: u.input_tokens_details.text_tokens }
			: {}),
		...(u.output_tokens_details?.image_tokens !== undefined
			? { outputImageTokens: u.output_tokens_details.image_tokens }
			: {}),
		...(u.output_tokens_details?.text_tokens !== undefined
			? { outputTextTokens: u.output_tokens_details.text_tokens }
			: {}),
	};
}

function imageData(raw: unknown): CanonicalImageData {
	const image = raw as {
		b64_json?: unknown;
		url?: unknown;
		revised_prompt?: unknown;
	};
	if (typeof image?.b64_json === "string") {
		return {
			b64Json: image.b64_json.replace(/^data:[^;]+;base64,/, ""),
			...(typeof image.revised_prompt === "string"
				? { revisedPrompt: image.revised_prompt }
				: {}),
		};
	}
	if (typeof image?.url === "string") {
		throw new GatewayError({
			class: "server",
			message:
				"Image upstream returned a URL instead of the required b64_json image",
			code: "upstream_image_response_format_mismatch",
		});
	}
	throw new GatewayError({
		class: "server",
		message: "Image upstream returned no b64_json image",
	});
}

export function parseDirectImagesResponse(
	raw: unknown,
): CanonicalImageResponse {
	const body = (raw ?? {}) as Record<string, unknown>;
	if (!Array.isArray(body.data))
		throw new GatewayError({
			class: "server",
			message: "Invalid Images API response",
		});
	const usage = imageUsage(body.usage);
	return {
		created:
			typeof body.created === "number"
				? body.created
				: Math.floor(Date.now() / 1000),
		data: body.data.map(imageData),
		...(typeof body.background === "string"
			? { background: body.background as ImageBackground }
			: {}),
		...(typeof body.output_format === "string"
			? { outputFormat: body.output_format as ImageOutputFormat }
			: {}),
		...(typeof body.quality === "string"
			? { quality: body.quality as ImageQuality }
			: {}),
		...(typeof body.size === "string" ? { size: body.size } : {}),
		...(usage ? { usage } : {}),
	};
}

export async function* parseDirectImageStream(
	stream: ReadableStream<Uint8Array>,
	operation: CanonicalImageRequest["operation"],
	options?: {
		onUnknownEvent?: (type: string) => void;
		onTransportTerminator?: (terminator: "done_marker") => void;
	},
): AsyncIterable<CanonicalImageStreamEvent> {
	for await (const sse of parseSSE(stream)) {
		if (sse.data === "[DONE]") {
			options?.onTransportTerminator?.("done_marker");
			return;
		}
		let raw: Record<string, unknown>;
		try {
			raw = JSON.parse(sse.data) as Record<string, unknown>;
		} catch (cause) {
			throw new GatewayError({
				class: "server",
				code: "upstream_protocol_error",
				message: "Image upstream emitted malformed JSON",
				provider: { body: sse.data },
				cause,
			});
		}
		if (raw.error)
			throw new GatewayError({
				class: "server",
				message: "Image upstream stream failed",
				provider: { body: raw },
			});
		const type = typeof raw.type === "string" ? raw.type : "";
		if (!type.endsWith(".partial_image") && !type.endsWith(".completed")) {
			options?.onUnknownEvent?.(type || "missing_type");
			continue;
		}
		const common = {
			operation,
			image: imageData(raw),
			createdAt:
				typeof raw.created_at === "number"
					? raw.created_at
					: Math.floor(Date.now() / 1000),
			...(typeof raw.background === "string"
				? { background: raw.background as ImageBackground }
				: {}),
			...(typeof raw.output_format === "string"
				? { outputFormat: raw.output_format as ImageOutputFormat }
				: {}),
			...(typeof raw.quality === "string"
				? { quality: raw.quality as ImageQuality }
				: {}),
			...(typeof raw.size === "string" ? { size: raw.size } : {}),
		};
		if (type.endsWith(".partial_image")) {
			yield {
				kind: "partial",
				...common,
				partialImageIndex:
					typeof raw.partial_image_index === "number"
						? raw.partial_image_index
						: 0,
			};
		} else {
			const usage = imageUsage(raw.usage);
			yield { kind: "completed", ...common, ...(usage ? { usage } : {}) };
		}
	}
}

async function inputAsDataUrl(
	input: NonNullable<CanonicalImageRequest["images"]>[number],
): Promise<string> {
	return `data:${input.mimeType};base64,${(await readFile(input.path)).toString("base64")}`;
}

export async function buildOmniImageBody(
	req: CanonicalImageRequest,
	upstreamModel: string,
	profile: ImageModelProfile | undefined,
): Promise<Record<string, unknown>> {
	const content: Array<Record<string, unknown>> = [
		{ type: "text", text: req.prompt },
	];
	for (const input of req.images ?? []) {
		content.push({
			type: "image_url",
			image_url: { url: await inputAsDataUrl(input) },
		});
	}
	const imageConfig: Record<string, unknown> = {};
	const mapping = resolveImageSize(req, profile);
	if (mapping?.aspectRatio) imageConfig.aspect_ratio = mapping.aspectRatio;
	if (mapping?.imageSize) imageConfig.image_size = mapping.imageSize;
	const body: Record<string, unknown> = {
		model: upstreamModel,
		messages: [{ role: "user", content }],
		modalities: ["image", "text"],
		...(req.n !== undefined ? { n: req.n } : {}),
		...(Object.keys(imageConfig).length > 0
			? { image_config: imageConfig }
			: {}),
	};
	return mergeExtraBodyDeep(body, req.extraBody, [
		"model",
		"messages",
		"modalities",
		"n",
		"stream",
		...(mapping?.aspectRatio ? ["image_config.aspect_ratio"] : []),
		...(mapping?.imageSize ? ["image_config.image_size"] : []),
	]);
}

export function parseOmniImageResponse(raw: unknown): CanonicalImageResponse {
	const body = (raw ?? {}) as {
		created?: number;
		choices?: Array<{
			message?: {
				images?: Array<{
					image_url?: { url?: string };
					imageUrl?: { url?: string };
				}>;
			};
		}>;
		usage?: {
			prompt_tokens?: number;
			completion_tokens?: number;
			total_tokens?: number;
		};
	};
	const images = (body.choices ?? []).flatMap(
		(choice) => choice.message?.images ?? [],
	);
	const data = images.map((image) => {
		const value = image.image_url?.url ?? image.imageUrl?.url;
		if (!value?.startsWith("data:"))
			throw new GatewayError({
				class: "server",
				message: "Omni image response is not a base64 data URL",
			});
		return { b64Json: value.replace(/^data:[^;]+;base64,/, "") };
	});
	if (data.length === 0)
		throw new GatewayError({
			class: "server",
			message: "Omni upstream returned no images",
		});
	const usage =
		body.usage?.total_tokens !== undefined
			? {
					inputTokens: body.usage.prompt_tokens ?? 0,
					outputTokens: body.usage.completion_tokens ?? 0,
					totalTokens: body.usage.total_tokens,
				}
			: undefined;
	return {
		created: body.created ?? Math.floor(Date.now() / 1000),
		data,
		...(usage ? { usage } : {}),
	};
}
