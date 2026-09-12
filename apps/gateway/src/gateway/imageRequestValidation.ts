import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { CanonicalImageRequest } from "#core/images.ts";
import { imageProfileFor } from "#catalog/types.ts";
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

export function assertImageRequestSupported(
	req: CanonicalImageRequest,
	meta: ResolvedModelMetadata,
): void {
	const profile = imageProfileFor(meta, req.operation);
	if (!profile)
		unsupported(
			"model",
			"The selected model has no profile for this image operation.",
		);

	if (
		profile.maxPromptChars !== undefined &&
		req.prompt.length > profile.maxPromptChars
	) {
		unsupported(
			"prompt",
			`The selected model accepts at most ${profile.maxPromptChars} prompt characters.`,
		);
	}
	const n = req.n ?? 1;
	if (profile.maxN !== undefined && n > profile.maxN)
		unsupported("n", `The selected model supports at most n=${profile.maxN}.`);
	if (req.stream && n !== 1) unsupported("n", "Image streaming requires n=1.");

	if (req.operation === "edit") {
		const images = req.images ?? [];
		if (images.length === 0)
			unsupported("image", "At least one input image is required.");
		if (
			profile.maxInputImages !== undefined &&
			images.length > profile.maxInputImages
		) {
			unsupported(
				"image",
				`The selected model accepts at most ${profile.maxInputImages} input images.`,
			);
		}
		const maxImageBytes = profile.maxImageBytes;
		if (
			maxImageBytes !== undefined &&
			images.some((image) => image.sizeBytes > maxImageBytes)
		) {
			unsupported(
				"image",
				`An input image exceeds the ${maxImageBytes} byte model limit.`,
			);
		}
		const totalInputBytes =
			images.reduce((total, image) => total + image.sizeBytes, 0) +
			(req.mask?.sizeBytes ?? 0);
		if (
			profile.maxTotalInputBytes !== undefined &&
			totalInputBytes > profile.maxTotalInputBytes
		) {
			unsupported(
				"image",
				`Input images exceed the ${profile.maxTotalInputBytes} byte aggregate model limit.`,
			);
		}
		if (req.mask && !profile.supportsMask)
			unsupported("mask", "The selected model does not support masks.");
		if (req.inputFidelity && !profile.supportsInputFidelity) {
			unsupported(
				"input_fidelity",
				"The selected model does not support input_fidelity.",
			);
		}
	}

	if (req.moderation && !profile.supportsModeration)
		unsupported(
			"moderation",
			"The selected model does not support moderation.",
		);
	if (req.style && !profile.supportsStyle)
		unsupported("style", "The selected model does not support style.");
	if (
		req.background === "transparent" &&
		!profile.supportsTransparentBackground
	) {
		unsupported(
			"background",
			"The selected model does not support transparent backgrounds.",
		);
	}
	if (req.outputFormat && !profile.outputFormats?.includes(req.outputFormat)) {
		unsupported(
			"output_format",
			`The selected model does not support output_format=${req.outputFormat}.`,
		);
	}
	if (req.quality && !profile.qualities?.includes(req.quality)) {
		unsupported(
			"quality",
			`The selected model does not support quality=${req.quality}.`,
		);
	}
	if (
		req.responseFormat &&
		!profile.responseFormats?.includes(req.responseFormat)
	) {
		unsupported(
			"response_format",
			`The selected model does not support response_format=${req.responseFormat}.`,
		);
	}
	if (
		req.stream &&
		profile.responseFormats &&
		!profile.responseFormats.includes("b64_json")
	) {
		unsupported(
			"stream",
			"The selected model cannot provide b64_json output required for image streaming.",
		);
	}
	if ((req.partialImages ?? 0) > 0 && !profile.supportsNativeStreaming) {
		unsupported(
			"partial_images",
			"The selected model cannot produce partial streaming images.",
		);
	}

	if (req.size && req.size !== "auto") {
		const direct = profile.sizes?.[req.size];
		if (!direct) {
			const match = /^(\d+)x(\d+)$/.exec(req.size);
			const arbitrary = profile.arbitrarySize;
			if (!match || !arbitrary)
				unsupported(
					"size",
					`The selected model does not support size=${req.size}.`,
				);
			const width = Number(match[1]);
			const height = Number(match[2]);
			const ratio = width / height;
			if (
				width % arbitrary.divisibleBy !== 0 ||
				height % arbitrary.divisibleBy !== 0 ||
				width > arbitrary.maxWidth ||
				height > arbitrary.maxHeight ||
				(arbitrary.maxPixels !== undefined &&
					width * height > arbitrary.maxPixels) ||
				ratio < arbitrary.minAspectRatio ||
				ratio > arbitrary.maxAspectRatio
			)
				unsupported(
					"size",
					`The selected model does not support size=${req.size}.`,
				);
		}
	}
}
