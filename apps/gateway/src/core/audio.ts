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
	| "vtt";
type TimestampGranularity = "word" | "segment";

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
	prompt?: string;
	temperature?: number;
	responseFormat: TranscriptionResponseFormat;
	timestampGranularities?: TimestampGranularity[];
	include?: string[];
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
	/** Maximum audio file size. */
	maxFileBytes?: number;
}

/** Converts the transcription usage to the core `Usage` (cost). */
export function transcriptionUsageToCore(
	u: TranscriptionUsage | undefined,
): Usage | null {
	if (!u || u.totalTokens === undefined) return null;
	return {
		promptTokens: u.inputTokens ?? 0,
		completionTokens: u.outputTokens ?? 0,
		totalTokens: u.totalTokens,
	};
}
