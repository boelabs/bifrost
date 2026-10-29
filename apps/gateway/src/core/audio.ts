import type { Usage } from "./usage.ts";

/**
 * Canonical audio types. Phase 1: transcription (/v1/audio/transcriptions). Public contract = OpenAI;
 * upstream = OpenAI or compatible (same transport), so it is almost passthrough: `text`/`srt`/`vtt`
 * travel as a plain-text body; `json`/`verbose_json` are parsed into fields.
 */

export type TranscriptionResponseFormat =
	| "json"
	| "text"
	| "srt"
	| "verbose_json"
	| "vtt"
	| "diarized_json";
export type TimestampGranularity = "word" | "segment";

/**
 * How literally the model transcribes. `verbatim` keeps what was said (the default everywhere);
 * `smart` removes fillers and formats numbers and alphanumerics in context.
 */
export type TranscriptionMode = "verbatim" | "smart";

/**
 * Request features a provider may refuse to combine. `timestamps` covers word/segment granularities
 * and the subtitle formats (srt/vtt) that need them; `diarization` is `response_format=diarized_json`.
 */
export type TranscriptionFeature =
	| "keywords"
	| "timestamps"
	| "diarization"
	| "smart_mode";

/** Formats whose upstream response body is plain text (not JSON). */
export const TEXT_TRANSCRIPTION_FORMATS: readonly TranscriptionResponseFormat[] =
	["text", "srt", "vtt"];

/** An audio file validated and stored on temporary disk during a multipart request. */
export interface CanonicalAudioInput {
	path: string;
	filename: string;
	mimeType: string;
	sizeBytes: number;
}

export interface CanonicalTranscriptionRequest {
	model: string;
	file: CanonicalAudioInput;
	language?: string;
	languages?: string[];
	keywords?: string[];
	prompt?: string;
	temperature?: number;
	responseFormat: TranscriptionResponseFormat;
	timestampGranularities?: TimestampGranularity[];
	include?: string[];
	mode?: TranscriptionMode;
	stream: boolean;
	extraBody?: Record<string, unknown>;
}

/**
 * Token-based transcription usage (gpt-4o-transcribe). Feeds the normal cost calc.
 *
 * Per-minute billing (whisper) is deliberately NOT supported: its duration-based usage variant is
 * omitted. Re-adding it later = one usage variant here + one pricing branch in the cost calc, both
 * localized (see the note at the end of the file).
 */
export interface TranscriptionUsage {
	type: "tokens";
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	inputTokenDetails?: { textTokens?: number; audioTokens?: number };
}

/**
 * Canonical transcription response. The adapter detects text-vs-JSON from the upstream body (string
 * for text/srt/vtt; object for json/verbose_json); the output FORMAT is decided by the endpoint from
 * `req.responseFormat`. `segments`/`words` are kept raw (passthrough) to re-emit them identical to the
 * OpenAI contract.
 */
export interface CanonicalTranscriptionResponse {
	text: string;
	language?: string;
	languages?: string[];
	duration?: number;
	segments?: Record<string, unknown>[];
	words?: Record<string, unknown>[];
	logprobs?: unknown;
	usage?: TranscriptionUsage;
}

export type CanonicalTranscriptionStreamEvent =
	| { kind: "delta"; delta: string; logprobs?: unknown }
	| {
			kind: "done";
			text: string;
			languages?: string[];
			usage?: TranscriptionUsage;
			logprobs?: unknown;
	  };

/**
 * Canonical constraints of a transcription model (the client contract). The gateway validates the
 * request against this before routing; the operator of a custom model only declares this.
 */
export interface TranscriptionProfile {
	/** Accepted response formats (json/text/srt/verbose_json/vtt). */
	responseFormats: TranscriptionResponseFormat[];
	/** The model supports SSE streaming (gpt-4o-transcribe does). */
	supportsStreaming?: boolean;
	/** Accepts `timestamp_granularities[]` (only with verbose_json). */
	supportsTimestampGranularities?: boolean;
	/** The granularities it can produce. Absent = every granularity. */
	timestampGranularities?: TimestampGranularity[];
	/** Accepts literal vocabulary hints; otherwise the gateway drops them. */
	supportsKeywords?: boolean;
	/** Most vocabulary hints one request may carry. */
	maxKeywords?: number;
	/** Accepts multiple language hints instead of the singular language field. */
	supportsLanguageHints?: boolean;
	/** Accepted `transcription_mode` values. Absent = verbatim only. */
	modes?: TranscriptionMode[];
	/** Groups of features the provider rejects when they appear together in one request. */
	incompatibleFeatures?: TranscriptionFeature[][];
	/** Maximum audio file size. */
	maxFileBytes?: number;
}

/** The features a request uses, in the vocabulary of `incompatibleFeatures`. */
export function transcriptionFeatures(
	req: Pick<
		CanonicalTranscriptionRequest,
		"keywords" | "timestampGranularities" | "responseFormat" | "mode"
	>,
): Set<TranscriptionFeature> {
	const features = new Set<TranscriptionFeature>();
	if (req.keywords && req.keywords.length > 0) {
		features.add("keywords");
	}
	if (
		(req.timestampGranularities && req.timestampGranularities.length > 0) ||
		req.responseFormat === "srt" ||
		req.responseFormat === "vtt"
	) {
		features.add("timestamps");
	}
	if (req.responseFormat === "diarized_json") {
		features.add("diarization");
	}
	if (req.mode === "smart") {
		features.add("smart_mode");
	}
	return features;
}

/** Converts the transcription usage to the core `Usage` (cost). */
export function transcriptionUsageToCore(
	u: TranscriptionUsage | undefined,
): Usage | null {
	if (!u || u.totalTokens === undefined) {
		return null;
	}
	return {
		promptTokens: u.inputTokens ?? 0,
		completionTokens: u.outputTokens ?? 0,
		totalTokens: u.totalTokens,
	};
}
