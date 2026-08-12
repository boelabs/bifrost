import type { CanonicalTranscriptionRequest } from "#core/audio.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import { transcriptionProfileFor } from "#catalog/types.ts";
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

export function assertTranscriptionRequestSupported(
	req: CanonicalTranscriptionRequest,
	meta: ResolvedModelMetadata,
): void {
	const profile = transcriptionProfileFor(meta);
	if (!profile)
		unsupported(
			"model",
			"The selected model has no audio transcription profile.",
		);

	if (!profile.responseFormats.includes(req.responseFormat)) {
		unsupported(
			"response_format",
			`The selected model does not support response_format=${req.responseFormat}.`,
		);
	}
	if (req.stream && !profile.supportsStreaming) {
		unsupported(
			"stream",
			"The selected model does not support streaming transcriptions.",
		);
	}
	if (req.timestampGranularities && req.timestampGranularities.length > 0) {
		if (!profile.supportsTimestampGranularities) {
			unsupported(
				"timestamp_granularities",
				"The selected model does not support timestamp_granularities.",
			);
		}
		if (req.responseFormat !== "verbose_json") {
			unsupported(
				"timestamp_granularities",
				"timestamp_granularities requires response_format=verbose_json.",
			);
		}
	}
	if (
		profile.maxFileBytes !== undefined &&
		req.file.sizeBytes > profile.maxFileBytes
	) {
		unsupported(
			"file",
			`The audio file exceeds the ${profile.maxFileBytes} byte model limit.`,
		);
	}
}
