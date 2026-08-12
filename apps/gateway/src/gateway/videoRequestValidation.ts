import type { CanonicalVideoRequest, VideoModelProfile } from "#core/videos.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import { videoProfileFor } from "#catalog/types.ts";
import { resolveVideoSize } from "#core/videos.ts";
import { GatewayError } from "#core/errors.ts";

function unsupported(param: string, message: string): never {
	throw new GatewayError({
		class: "bad_request",
		message,
		code: "unsupported_parameter",
		param,
		publicMessage: message,
	});
}

function dataUrlSizeBytes(url: string): number | undefined {
	const match = /^data:[^;]+;base64,(.*)$/s.exec(url);
	if (!match) return undefined;
	return Math.floor((match[1]!.length * 3) / 4);
}

function assertImageUrlSupported(
	url: string,
	param: string,
	profile: VideoModelProfile,
): void {
	if (profile.requiresDataUrlImageReference && !url.startsWith("data:image/")) {
		unsupported(
			param,
			"The selected model only supports image references as data:image/... URLs.",
		);
	}
	const sizeBytes = dataUrlSizeBytes(url);
	if (
		sizeBytes !== undefined &&
		profile.maxReferenceBytes !== undefined &&
		sizeBytes > profile.maxReferenceBytes
	) {
		unsupported(
			param,
			`The selected model accepts reference images up to ${profile.maxReferenceBytes} bytes.`,
		);
	}
}

function assertDimensionsSupported(
	req: CanonicalVideoRequest,
	profile: VideoModelProfile,
): void {
	if (req.size && !profile.sizes?.[req.size]) {
		unsupported(
			"size",
			`The selected model does not support size=${req.size}.`,
		);
	}
	if (!req.aspectRatio && !req.resolution) return;
	const resolved = resolveVideoSize(req, profile);
	// Without a profile size table there is nothing to check against; the adapter forwards as-is.
	if (!profile.sizes) return;
	if (!resolved?.size) {
		const requested = [
			...(req.aspectRatio ? [`aspect_ratio=${req.aspectRatio}`] : []),
			...(req.resolution ? [`resolution=${req.resolution}`] : []),
		].join(", ");
		unsupported(
			req.aspectRatio ? "aspect_ratio" : "resolution",
			`The selected model does not support ${requested}.`,
		);
	}
}

function assertReferencesSupported(
	req: CanonicalVideoRequest,
	profile: VideoModelProfile,
): void {
	const refs = req.inputReferences ?? [];
	if (
		profile.maxInputReferences !== undefined &&
		refs.length > profile.maxInputReferences
	) {
		unsupported(
			"input_references",
			`The selected model accepts at most ${profile.maxInputReferences} input references.`,
		);
	}
	for (const ref of refs) {
		if (ref.type === "file_id" && !profile.supportsFileId) {
			unsupported(
				"input_reference.file_id",
				"The selected model does not support file_id references.",
			);
		}
		if (ref.type === "image_url") {
			if (!profile.supportsImageUrl) {
				unsupported(
					"input_references",
					"The selected model does not support image references.",
				);
			}
			assertImageUrlSupported(ref.url, "input_references", profile);
		}
		if (ref.type === "audio_url" && !profile.supportsAudioUrl) {
			unsupported(
				"input_references",
				"The selected model does not support audio references.",
			);
		}
		if (ref.type === "video_url" && !profile.supportsVideoUrl) {
			unsupported(
				"input_references",
				"The selected model does not support video references.",
			);
		}
	}
	if (req.frameImages && req.frameImages.length > 0) {
		if (!profile.supportsFrameImages) {
			unsupported(
				"frame_images",
				"The selected model does not support frame images.",
			);
		}
		for (const frame of req.frameImages)
			assertImageUrlSupported(frame.url, "frame_images", profile);
	}
}

export function assertVideoRequestSupported(
	req: CanonicalVideoRequest,
	meta: ResolvedModelMetadata,
): void {
	const profile = videoProfileFor(meta);
	if (!profile) {
		unsupported(
			"model",
			"The selected model has no profile for video generation.",
		);
	}

	if (
		profile.maxPromptChars !== undefined &&
		req.prompt.length > profile.maxPromptChars
	) {
		unsupported(
			"prompt",
			`The selected model accepts at most ${profile.maxPromptChars} prompt characters.`,
		);
	}
	if (req.seconds && !profile.durations?.includes(req.seconds)) {
		unsupported(
			"duration",
			`The selected model does not support a duration of ${req.seconds} seconds.`,
		);
	}
	assertDimensionsSupported(req, profile);
	if (req.quality && !profile.qualities?.includes(req.quality)) {
		unsupported(
			"quality",
			`The selected model does not support quality=${req.quality}.`,
		);
	}
	if (req.seed !== undefined && !profile.supportsSeed) {
		unsupported("seed", "The selected model does not support seed.");
	}
	if (req.generateAudio !== undefined && !profile.supportsGenerateAudio) {
		unsupported(
			"generate_audio",
			"The selected model does not support generate_audio.",
		);
	}
	assertReferencesSupported(req, profile);
}
