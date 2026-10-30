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

/** Token usage the provider reported for part of a session. Details are subsets of their totals. */
export interface RealtimeUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	/** Input audio tokens. */
	audioTokens?: number;
	/** Input text tokens. */
	textTokens?: number;
	/** Input image tokens. */
	imageTokens?: number;
	/** Input tokens served from the provider's cache. */
	cachedTokens?: number;
	outputAudioTokens?: number;
	outputTextTokens?: number;
}

export type CanonicalRealtimeTranscriptionEvent =
	/** The provider's current guess for the open utterance; each one replaces the previous. */
	| { kind: "interim"; text: string }
	/** The utterance is final. */
	| { kind: "final"; text: string }
	| { kind: "usage"; usage: RealtimeUsage };

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

const DETAIL_KEYS = [
	"audioTokens",
	"textTokens",
	"imageTokens",
	"cachedTokens",
	"outputAudioTokens",
	"outputTextTokens",
] as const;

export function addRealtimeUsage(
	total: RealtimeUsage | null,
	usage: RealtimeUsage,
): RealtimeUsage {
	if (!total) {
		return { ...usage };
	}
	const sum = (a: number | undefined, b: number | undefined) =>
		a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);
	const details: Partial<RealtimeUsage> = {};
	for (const key of DETAIL_KEYS) {
		const value = sum(total[key], usage[key]);
		if (value !== undefined) {
			details[key] = value;
		}
	}
	return {
		inputTokens: total.inputTokens + usage.inputTokens,
		outputTokens: total.outputTokens + usage.outputTokens,
		totalTokens: total.totalTokens + usage.totalTokens,
		...details,
	};
}

/** Converts realtime usage to the core `Usage` (cost, quotas, metrics). */
export function realtimeUsageToCore(u: RealtimeUsage | null): Usage | null {
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
		...(u.imageTokens === undefined
			? {}
			: { promptImageTokens: u.imageTokens }),
		...(u.cachedTokens === undefined
			? {}
			: { cacheReadTokens: u.cachedTokens }),
		...(u.outputAudioTokens === undefined
			? {}
			: { completionAudioTokens: u.outputAudioTokens }),
	};
}

/* ------------------------------------------------------------------ conversation */

/**
 * Canonical realtime conversation: speech (or text) in, a spoken (or written) model turn out, with
 * function calling. The public contract is OpenAI's Realtime API (`/v1/realtime?model=`, session
 * `type: "realtime"`); adapters speak their provider's live protocol. Input audio crosses this
 * boundary as 16 kHz PCM16 like transcription; output audio as 24 kHz PCM16.
 */

export const REALTIME_OUTPUT_SAMPLE_RATE = 24_000;

export type RealtimeOutputModality = "audio" | "text";

/** How a provider's voice activity detection ends turns; `null` in the config means manual turns. */
export interface RealtimeVadConfig {
	type: "server_vad" | "semantic_vad";
	/** 0..1; higher needs louder speech to start a turn. */
	threshold?: number;
	prefixPaddingMs?: number;
	silenceDurationMs?: number;
	/** semantic_vad: how readily a pause ends the turn. */
	eagerness?: "low" | "medium" | "high" | "auto";
	/** Speech during a response interrupts it. */
	interruptResponse: boolean;
	/** The end of the user's turn starts a response by itself. */
	createResponse: boolean;
	/** server_vad: prompt the model after this much silence following its reply. */
	idleTimeoutMs?: number;
}

export interface RealtimeFunctionDeclaration {
	name: string;
	description?: string;
	/** JSON Schema. */
	parameters?: Record<string, unknown>;
}

export type RealtimeReasoningEffort =
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh";

export interface CanonicalRealtimeConversationConfig {
	model: string;
	instructions?: string;
	outputModality: RealtimeOutputModality;
	voice?: string;
	/** Playback speed of the reply; 1 = normal. */
	speed?: number;
	/** `null`: the client ends each turn (`turn_detection: null`). */
	vad: RealtimeVadConfig | null;
	/**
	 * Transcribe the user's speech; `null` = off. `model` is the client's choice of transcription
	 * model, for providers that take one (OpenAI); others transcribe with the live model itself.
	 */
	inputTranscription: {
		model?: string;
		languages?: string[];
		keywords?: string[];
	} | null;
	tools: RealtimeFunctionDeclaration[];
	/** `tool_choice: "none"` keeps the declarations out of the provider session. */
	toolChoice: "auto" | "none";
	/** Provider-hosted web search (Bifrozz extension tool `{type: "google_search"}`). */
	googleSearch: boolean;
	maxOutputTokens?: number;
	reasoningEffort?: RealtimeReasoningEffort;
	/** `auto`: the provider compresses old context so a long session keeps going. */
	truncation: "auto" | "disabled";
	/** Speech-to-speech translation models (Bifrozz extension `session.translation`). */
	translation?: { targetLanguage: string; echoTargetLanguage?: boolean };
}

export type RealtimeContentPart =
	| { type: "text"; text: string }
	| { type: "image"; mimeType: string; data: string }
	/** 16 kHz PCM16. */
	| { type: "audio"; pcm: Buffer };

export interface RealtimeTurn {
	role: "user" | "model";
	parts: RealtimeContentPart[];
}

export interface RealtimeFunctionCall {
	/** The provider's call id; it becomes OpenAI's `call_id`. */
	id: string;
	name: string;
	/** JSON-encoded arguments. */
	arguments: string;
}

export interface RealtimeFunctionResult {
	id: string;
	name: string;
	/** The client's output string, as given. */
	output: string;
}

export type CanonicalRealtimeConversationEvent =
	/** The provider heard the user start or stop speaking (server VAD). */
	| { kind: "speech_started" }
	| { kind: "speech_stopped" }
	/** The user's speech so far; each one replaces the previous. */
	| { kind: "input_transcript_interim"; text: string }
	/** More of the user's speech, final; appended to what came before. */
	| { kind: "input_transcript"; text: string }
	/** 24 kHz PCM16 of the model's reply. */
	| { kind: "output_audio"; pcm: Buffer }
	/** Text the model wrote (text modality). */
	| { kind: "output_text"; text: string }
	/** The transcript of the model's spoken reply, appended chunk by chunk. */
	| { kind: "output_transcript"; text: string }
	| { kind: "function_calls"; calls: RealtimeFunctionCall[] }
	/** The provider dropped calls it had asked for (the user interrupted). */
	| { kind: "function_calls_cancelled"; ids: string[] }
	/** The user's speech cut the reply short. */
	| { kind: "interrupted" }
	/** The model has generated its whole reply (it may still be "playing" it). */
	| { kind: "generation_complete" }
	/** The model's turn is over. */
	| { kind: "turn_complete" }
	/** The provider refused an event; the session goes on. Its message stays private. */
	| { kind: "provider_error"; code: string | null }
	| { kind: "usage"; usage: RealtimeUsage };

/**
 * Canonical constraints of a realtime conversation model. The gateway validates every session
 * against this before the provider sees it.
 */
export interface RealtimeConversationProfile {
	/** What the model answers with natively. A text session on an audio-only model is served from
	 * the transcript of its spoken reply. */
	outputModalities: RealtimeOutputModality[];
	/** Prebuilt voices the model speaks with. Absent = the provider's default only. */
	voices?: string[];
	/** Accepts session instructions. */
	supportsInstructions?: boolean;
	/** Accepts function tools. */
	supportsTools?: boolean;
	/** How function calls run: `blocking` (the model waits for the result, like OpenAI) or only
	 * `non_blocking` (it keeps talking). Absent = blocking. */
	functionCalling?: "blocking" | "non_blocking";
	supportsGoogleSearch?: boolean;
	/** Accepted `reasoning.effort` values. Absent = reasoning is not configurable. */
	reasoningEfforts?: RealtimeReasoningEffort[];
	/** Sent when the session sets no effort, for models that refuse to start without one. */
	defaultReasoningEffort?: RealtimeReasoningEffort;
	/** Server VAD can leave answering to the client (`create_response: false`). */
	supportsDeferredResponse?: boolean;
	/** Accepts a speaking speed other than 1. */
	supportsSpeed?: boolean;
	/** Accepts text items from the client. */
	supportsTextInput?: boolean;
	supportsImageInput?: boolean;
	/** Accepts input transcription (vocabulary hints included). */
	supportsInputTranscription?: boolean;
	maxKeywords?: number;
	/** Translation model: requires `session.translation.target_language`. */
	translation?: boolean;
	/** How turns may end. Absent = all. */
	turnDetection?: Array<"server_vad" | "semantic_vad" | "manual">;
	/** The provider can resume a session on a new connection (context kept, configuration not). */
	supportsSessionResumption?: boolean;
	/**
	 * A new session can be seeded with the conversation so far (Gemini's `historyConfig`, function
	 * calls included). Without it, history is sent as plain turns and function calls as text.
	 */
	supportsHistoryConfig?: boolean;
	/** The provider can compress old context so the session outlives its context window. */
	supportsContextCompression?: boolean;
	/** The provider ends a single upstream connection after this long; the gateway reconnects. */
	maxUpstreamSessionSeconds?: number;
}
