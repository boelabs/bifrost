import type { TranscriptionMode } from "./audio.ts";
import type { Usage } from "./usage.ts";

/**
 * Canonical realtime transcription: a live audio stream in, utterance transcripts out.
 *
 * The public contract is OpenAI's Realtime API in transcription mode (`/v1/realtime?intent=
 * transcription`); adapters speak their provider's live protocol (Gemini's Live API). Audio crosses
 * this boundary as 16-bit little-endian mono PCM at 16 kHz, whatever format the client chose.
 */

export const REALTIME_AUDIO_SAMPLE_RATE = 16_000;

/**
 * Who ends an utterance. `server_vad`: the provider detects pauses. `manual`: the client's
 * `input_audio_buffer.commit` does (OpenAI's `turn_detection: null`).
 */
export type RealtimeTurnDetection = "server_vad" | "manual";

export interface CanonicalRealtimeTranscriptionConfig {
	model: string;
	language?: string;
	languages?: string[];
	keywords?: string[];
	mode?: TranscriptionMode;
	turnDetection: RealtimeTurnDetection;
}

/** Token usage the provider reported for part of a session. */
export interface RealtimeTranscriptionUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	audioTokens?: number;
	textTokens?: number;
}

export type CanonicalRealtimeTranscriptionEvent =
	/** The provider's current guess for the open utterance; each one replaces the previous. */
	| { kind: "interim"; text: string }
	/** The utterance is final. */
	| { kind: "final"; text: string }
	| { kind: "usage"; usage: RealtimeTranscriptionUsage };

/**
 * Canonical constraints of a realtime transcription model. The gateway validates every
 * `session.update` against this before the provider sees it.
 */
export interface RealtimeTranscriptionProfile {
	/** Accepts literal vocabulary hints; otherwise the gateway drops them. */
	supportsKeywords?: boolean;
	/** Most vocabulary hints one session may carry. */
	maxKeywords?: number;
	/** Accepts multiple language hints instead of the singular language field. */
	supportsLanguageHints?: boolean;
	/** Accepted `transcription_mode` values. Absent = verbatim only. */
	modes?: TranscriptionMode[];
	/** How utterances may end. Absent = both. */
	turnDetection?: RealtimeTurnDetection[];
	/** The provider ends a single upstream session after this long; the gateway reconnects. */
	maxUpstreamSessionSeconds?: number;
}

export function addRealtimeUsage(
	total: RealtimeTranscriptionUsage | null,
	usage: RealtimeTranscriptionUsage,
): RealtimeTranscriptionUsage {
	if (!total) {
		return { ...usage };
	}
	const sum = (a: number | undefined, b: number | undefined) =>
		a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
	const audioTokens = sum(total.audioTokens, usage.audioTokens);
	const textTokens = sum(total.textTokens, usage.textTokens);
	return {
		inputTokens: total.inputTokens + usage.inputTokens,
		outputTokens: total.outputTokens + usage.outputTokens,
		totalTokens: total.totalTokens + usage.totalTokens,
		...(audioTokens === undefined ? {} : { audioTokens }),
		...(textTokens === undefined ? {} : { textTokens }),
	};
}

/** Converts realtime usage to the core `Usage` (cost, quotas, metrics). */
export function realtimeUsageToCore(
	u: RealtimeTranscriptionUsage | null,
): Usage | null {
	if (!u) {
		return null;
	}
	return {
		promptTokens: u.inputTokens,
		completionTokens: u.outputTokens,
		totalTokens: u.inputTokens + u.outputTokens,
		...(u.audioTokens === undefined
			? {}
			: { promptAudioTokens: u.audioTokens }),
	};
}
