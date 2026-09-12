import type { Usage } from "./usage.ts";

export type ImageOperation = "generation" | "edit";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageBackground = "transparent" | "opaque" | "auto";
export type ImageQuality =
	| "standard"
	| "hd"
	| "low"
	| "medium"
	| "high"
	| "auto";
type ImageResponseFormat = "b64_json";

/** A file validated and stored temporarily during a multipart request. */
export interface CanonicalImageInput {
	path: string;
	filename: string;
	mimeType: "image/png" | "image/jpeg" | "image/webp";
	sizeBytes: number;
	width: number;
	height: number;
	hasAlpha?: boolean;
}

export interface CanonicalImageRequest {
	operation: ImageOperation;
	model: string;
	prompt: string;
	images?: CanonicalImageInput[];
	mask?: CanonicalImageInput;
	background?: ImageBackground;
	inputFidelity?: "high" | "low";
	moderation?: "low" | "auto";
	n?: number;
	outputCompression?: number;
	outputFormat?: ImageOutputFormat;
	partialImages?: number;
	quality?: ImageQuality;
	responseFormat?: ImageResponseFormat;
	size?: string;
	stream: boolean;
	style?: "vivid" | "natural";
	user?: string;
	extraBody?: Record<string, unknown>;
}

export interface ImageUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	inputImageTokens?: number;
	inputTextTokens?: number;
	outputImageTokens?: number;
	outputTextTokens?: number;
}

export function imageUsageToCore(u: ImageUsage | undefined): Usage | null {
	if (!u) return null;
	return {
		promptTokens: u.inputTokens,
		completionTokens: u.outputTokens,
		totalTokens: u.totalTokens,
	};
}

export interface CanonicalImageData {
	b64Json: string;
	revisedPrompt?: string;
	mimeType?: string;
	width?: number;
	height?: number;
}

export interface CanonicalImageResponse {
	created: number;
	data: CanonicalImageData[];
	background?: ImageBackground;
	outputFormat?: ImageOutputFormat;
	quality?: ImageQuality;
	size?: string;
	usage?: ImageUsage;
}

export type CanonicalImageStreamEvent =
	| {
			kind: "partial";
			operation: ImageOperation;
			image: CanonicalImageData;
			partialImageIndex: number;
			createdAt: number;
			background?: ImageBackground;
			outputFormat?: ImageOutputFormat;
			quality?: ImageQuality;
			size?: string;
	  }
	| {
			kind: "completed";
			operation: ImageOperation;
			image: CanonicalImageData;
			createdAt: number;
			background?: ImageBackground;
			outputFormat?: ImageOutputFormat;
			quality?: ImageQuality;
			size?: string;
			usage?: ImageUsage;
	  };

export interface ImageSizeMapping {
	/** Native fields for image-config transports. */
	aspectRatio?: string;
	imageSize?: string;
}

/**
 * Canonical constraints of an image model. Two sets of fields:
 *  - **Client contract**: what the client can request; the gateway validates the request against this.
 *  - **Gateway behavior**: how it operates internally. Optional, with safe defaults; the operator of a
 *    custom model normally only declares the client contract.
 */
export interface ImageModelProfile {
	// ── Client contract (request validation) ──
	maxPromptChars?: number;
	maxInputImages?: number;
	maxImageBytes?: number;
	maxTotalInputBytes?: number;
	maxN?: number;
	supportsMask?: boolean;
	supportsInputFidelity?: boolean;
	supportsModeration?: boolean;
	supportsStyle?: boolean;
	supportsTransparentBackground?: boolean;
	outputFormats?: ImageOutputFormat[];
	qualities?: ImageQuality[];
	responseFormats?: ImageResponseFormat[];
	/**
	 * Exact accepted dimensions. The first entry is the model's default: `size: "auto"` (or an
	 * omitted size) resolves to it when the model has no native auto (`autoSize` absent).
	 */
	sizes?: Record<string, ImageSizeMapping>;
	/**
	 * Declares native support for `size: "auto"` (the model picks the dimensions itself, e.g. from
	 * the input images of an edit). An empty object means "send no size fields / forward the native
	 * auto value"; set mapping fields when the provider needs an explicit native translation.
	 */
	autoSize?: ImageSizeMapping;
	arbitrarySize?: {
		divisibleBy: number;
		minAspectRatio: number;
		maxAspectRatio: number;
		maxWidth: number;
		maxHeight: number;
		maxPixels?: number;
	};

	// ── Gateway behavior (internal; safe defaults if omitted) ──
	/** The provider emits native streaming events; if not, the gateway synthesizes the final one. */
	supportsNativeStreaming?: boolean;
	/** false when the gateway must transcode the format/compression and not forward those fields. */
	nativeOutputFormat?: boolean;
	nativeOutputCompression?: boolean;
	/** Native translations of the public `quality` knob for image models with thinking. */
	qualityMappings?: Partial<
		Record<ImageQuality, { thinkingLevel?: "minimal" | "low" | "high" }>
	>;
}

/** The provider-facing dimensions resolved from the requested `size` via the profile. */
export interface ResolvedImageSize {
	/** Exact WIDTHxHEIGHT, or the literal `auto` for models with native auto support. */
	size?: string;
	aspectRatio?: string;
	imageSize?: string;
}

/**
 * Resolves the requested `size` against the profile's size table. `auto` (and an omitted size,
 * which is equivalent) resolves to the profile's `autoSize` mapping when the model supports auto
 * natively, and falls back to the first `sizes` entry — the model's default — otherwise, so every
 * image model accepts `size: "auto"` deterministically. Returns undefined when the profile
 * declares nothing to send.
 */
export function resolveImageSize(
	req: Pick<CanonicalImageRequest, "size">,
	profile: ImageModelProfile | undefined,
): ResolvedImageSize | undefined {
	if (req.size && req.size !== "auto") {
		const mapping = profile?.sizes?.[req.size];
		return {
			size: req.size,
			...(mapping?.aspectRatio ? { aspectRatio: mapping.aspectRatio } : {}),
			...(mapping?.imageSize ? { imageSize: mapping.imageSize } : {}),
		};
	}
	if (profile?.autoSize) {
		return {
			size: "auto",
			...(profile.autoSize.aspectRatio
				? { aspectRatio: profile.autoSize.aspectRatio }
				: {}),
			...(profile.autoSize.imageSize
				? { imageSize: profile.autoSize.imageSize }
				: {}),
		};
	}
	const first = Object.entries(profile?.sizes ?? {})[0];
	if (!first) return undefined;
	const [size, mapping] = first;
	return {
		size,
		...(mapping.aspectRatio ? { aspectRatio: mapping.aspectRatio } : {}),
		...(mapping.imageSize ? { imageSize: mapping.imageSize } : {}),
	};
}
