import type { ResolvedModelMetadata } from "#catalog/types.ts";
import { transcriptionProfileFor } from "#catalog/types.ts";
import { GatewayError } from "#core/errors.ts";

import {
	type CanonicalTranscriptionRequest,
	type TranscriptionFeature,
	transcriptionFeatures,
} from "#core/audio.ts";

function unsupported(param: string, message: string): never {
	throw new GatewayError({
		class: "bad_request",
		message,
		code: "unsupported_parameter",
		param,
		publicMessage: message,
	});
}

/** The public parameter that turns each feature on, for error messages. */
const FEATURE_PARAMS: Record<TranscriptionFeature, string> = {
	keywords: "keywords",
	timestamps: "timestamp_granularities",
	diarization: "response_format",
	smart_mode: "transcription_mode",
};

const FEATURE_LABELS: Record<TranscriptionFeature, string> = {
	keywords: "keywords",
	timestamps: "timestamps (timestamp_granularities, srt or vtt)",
	diarization: "speaker diarization (diarized_json)",
	smart_mode: "transcription_mode=smart",
};

export function assertTranscriptionRequestSupported(
	req: CanonicalTranscriptionRequest,
	meta: ResolvedModelMetadata,
): void {
	const profile = transcriptionProfileFor(meta);
	if (!profile) {
		unsupported(
			"model",
			"The selected model has no audio transcription profile.",
		);
	}

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
		const allowed = profile.timestampGranularities;
		const refused = allowed
			? req.timestampGranularities.find(
					(granularity) => !allowed.includes(granularity),
				)
			: undefined;
		if (refused !== undefined) {
			unsupported(
				"timestamp_granularities",
				`The selected model does not support timestamp_granularities=${refused}.`,
			);
		}
	}
	if (
		req.mode !== undefined &&
		req.mode !== "verbatim" &&
		!(profile.modes ?? []).includes(req.mode)
	) {
		unsupported(
			"transcription_mode",
			`The selected model does not support transcription_mode=${req.mode}.`,
		);
	}
	if (
		profile.supportsKeywords &&
		profile.maxKeywords !== undefined &&
		(req.keywords?.length ?? 0) > profile.maxKeywords
	) {
		unsupported(
			"keywords",
			`The selected model accepts at most ${profile.maxKeywords} keywords.`,
		);
	}
	// Keywords a model does not support are dropped, so they cannot conflict with anything.
	const features = transcriptionFeatures(
		profile.supportsKeywords ? req : { ...req, keywords: [] },
	);
	for (const group of profile.incompatibleFeatures ?? []) {
		const present = group.filter((feature) => features.has(feature));
		const [first, second] = present;
		if (first !== undefined && second !== undefined) {
			unsupported(
				FEATURE_PARAMS[second],
				`The selected model cannot combine ${FEATURE_LABELS[first]} with ${FEATURE_LABELS[second]}.`,
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
