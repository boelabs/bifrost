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

function invalidTaskInput(param: string, message: string): never {
	throw new GatewayError({
		class: "bad_request",
		message,
		code: "invalid_video_task",
		param,
		publicMessage: message,
	});
}

function assertTaskInputs(req: CanonicalVideoRequest): void {
	const refs = req.inputReferences ?? [];
	const frameImages = req.frameImages ?? [];
	const imageCount =
		refs.filter((ref) => ref.type === "image_url").length + frameImages.length;
	const videoCount = refs.filter((ref) => ref.type === "video_url").length;
	const otherCount = refs.filter(
		(ref) => ref.type !== "image_url" && ref.type !== "video_url",
	).length;

	const firstFrames = frameImages.filter((frame) => frame.frame === "first");
	const lastFrames = frameImages.filter((frame) => frame.frame === "last");
	if (firstFrames.length > 1 || lastFrames.length > 1) {
		invalidTaskInput(
			"frame_images",
			"Provide at most one first frame and one last frame.",
		);
	}
	if (lastFrames.length === 1 && firstFrames.length === 0) {
		invalidTaskInput("frame_images", "A last frame requires a first frame.");
	}

	if (req.task === undefined) return;
	if (req.task === "text_to_video" && refs.length + frameImages.length > 0) {
		invalidTaskInput(
			"task",
			"text_to_video cannot be combined with media inputs.",
		);
	}
	if (
		req.task === "image_to_video" &&
		(imageCount === 0 || videoCount > 0 || otherCount > 0)
	) {
		invalidTaskInput(
			"task",
			"image_to_video requires image inputs and cannot use video, audio, or file references.",
		);
	}
	if (
		req.task === "reference_to_video" &&
		(refs.length === 0 || frameImages.length > 0)
	) {
		invalidTaskInput(
			"task",
			"reference_to_video requires input_references and cannot use frame_images.",
		);
	}
	if (req.task === "edit" || req.task === "extend") {
		if (videoCount !== 1 || frameImages.length > 0) {
			invalidTaskInput(
				"task",
				`${req.task} requires exactly one video reference and cannot use frame_images.`,
			);
		}
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
	if (req.task && !profile.tasks?.includes(req.task)) {
		unsupported(
			"task",
			`The selected model does not support task=${req.task}.`,
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
	assertTaskInputs(req);
	assertReferencesSupported(req, profile);
}
