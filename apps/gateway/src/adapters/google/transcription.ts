import type { TranscriptionProfile } from "#core/audio.ts";
import { mergeExtraBodyDeep } from "#core/extraBody.ts";
import { GatewayError } from "#core/errors.ts";

import type {
	CanonicalTranscriptionResponse,
	CanonicalTranscriptionRequest,
	TranscriptionUsage,
} from "#core/audio.ts";

/**
 * Gemini Transcribe over the Interactions API (`POST /interactions`).
 *
 * The public contract stays OpenAI's /v1/audio/transcriptions: `keywords` become
 * `custom_vocabulary`, `language`/`languages` become `language_codes`, `diarized_json` turns on
 * speaker diarization, word granularity turns on word timestamps, and `transcription_mode=smart`
 * selects Gemini's smart mode. srt/vtt are built from word timestamps, which Gemini only returns
 * when asked for, so those formats request them too.
 */

/** Gemini's audio `mime_type` enum, keyed by the MIME the multipart parser assigns. */
const GEMINI_AUDIO_MIME: Record<string, string> = {
	"audio/flac": "audio/flac",
	"audio/mpeg": "audio/mpeg",
	"audio/mp4": "audio/m4a",
	"audio/wav": "audio/wav",
	"audio/webm": "audio/webm",
	"audio/ogg": "audio/ogg",
};

/** A word Gemini timed (and, with diarization, attributed). Offsets are seconds. */
export interface GeminiTranscriptWord {
	text: string;
	start: number;
	end: number;
	speaker?: string;
	/** Character range in the transcript, when Gemini reports it. */
	startIndex?: number;
	endIndex?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function wantsWordTimestamps(req: CanonicalTranscriptionRequest): boolean {
	return (
		(req.timestampGranularities ?? []).includes("word") ||
		req.responseFormat === "srt" ||
		req.responseFormat === "vtt"
	);
}

export function geminiAudioMimeType(mimeType: string): string {
	const mapped = GEMINI_AUDIO_MIME[mimeType];
	if (!mapped) {
		const message = `Gemini transcription does not accept ${mimeType} audio.`;
		throw new GatewayError({
			class: "bad_request",
			code: "unsupported_parameter",
			message,
			publicMessage: message,
			param: "file",
		});
	}
	return mapped;
}

/** Builds the `/interactions` body. `audioBase64` is the uploaded file, inline. */
export function geminiTranscriptionBody(
	req: CanonicalTranscriptionRequest,
	upstreamModel: string,
	audioBase64: string,
	profile: TranscriptionProfile | undefined,
): Record<string, unknown> {
	const config: Record<string, unknown> = {};
	const languages =
		req.languages ?? (req.language === undefined ? [] : [req.language]);
	if (languages.length > 0) {
		config.language_codes = languages;
	}
	if (profile?.supportsKeywords && req.keywords && req.keywords.length > 0) {
		config.custom_vocabulary = req.keywords;
	}
	if (req.mode === "smart") {
		config.mode = "smart";
	} else {
		const diarize = req.responseFormat === "diarized_json";
		const words = wantsWordTimestamps(req);
		if (diarize || words) {
			config.mode = {
				type: "verbatim",
				...(diarize ? { diarization_mode: "speaker" } : {}),
				...(words ? { timestamp_granularities: ["word"] } : {}),
			};
		}
	}
	// The config objects exist during the merge so extra_body reaches the managed paths' check even
	// when the request sets none of them; empty ones are dropped afterwards.
	const body = mergeExtraBodyDeep(
		{
			model: upstreamModel,
			input: [
				{
					type: "audio",
					data: audioBase64,
					mime_type: geminiAudioMimeType(req.file.mimeType),
				},
			],
			generation_config: { transcription_config: config },
		},
		req.extraBody,
		MANAGED_PATHS,
	);
	const generation = record(body.generation_config) ?? {};
	if (Object.keys(record(generation.transcription_config) ?? {}).length === 0) {
		delete generation.transcription_config;
	}
	if (Object.keys(generation).length === 0) {
		delete (body as Record<string, unknown>).generation_config;
	}
	return body;
}

const MANAGED_PATHS = [
	"model",
	"input",
	"stream",
	"background",
	"generation_config.transcription_config.language_codes",
	"generation_config.transcription_config.custom_vocabulary",
	"generation_config.transcription_config.mode",
];

/** `"1.250s"` (protobuf Duration JSON) -> 1.25. */
function offsetSeconds(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	const seconds = Number(value.trim().replace(/s$/, ""));
	return Number.isFinite(seconds) ? seconds : undefined;
}

function nonNegativeInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: undefined;
}

interface GeminiTranscript {
	text: string;
	words: GeminiTranscriptWord[];
}

/** The transcript and its timed words from the interaction's model output. */
function geminiTranscript(raw: Record<string, unknown>): GeminiTranscript {
	let text = "";
	const words: GeminiTranscriptWord[] = [];
	const steps = Array.isArray(raw.steps) ? raw.steps : [];
	for (const stepValue of steps) {
		const step = record(stepValue);
		if (step?.type !== "model_output" || !Array.isArray(step.content)) {
			continue;
		}
		for (const contentValue of step.content) {
			const content = record(contentValue);
			if (content?.type !== "text" || typeof content.text !== "string") {
				continue;
			}
			const offset = text.length;
			text += content.text;
			const annotations = Array.isArray(content.annotations)
				? content.annotations
				: [];
			for (const annotationValue of annotations) {
				const annotation = record(annotationValue);
				if (annotation?.type !== "word_info") {
					continue;
				}
				const start = offsetSeconds(annotation.start_offset);
				const end = offsetSeconds(annotation.end_offset);
				if (typeof annotation.text !== "string" || start === undefined) {
					continue;
				}
				const startIndex = nonNegativeInt(annotation.start_index);
				const endIndex = nonNegativeInt(annotation.end_index);
				words.push({
					text: annotation.text,
					start,
					end: end ?? start,
					...(typeof annotation.speaker === "string"
						? { speaker: annotation.speaker }
						: {}),
					...(startIndex === undefined
						? {}
						: { startIndex: startIndex + offset }),
					...(endIndex === undefined ? {} : { endIndex: endIndex + offset }),
				});
			}
		}
	}
	if (text === "" && typeof raw.output_text === "string") {
		text = raw.output_text;
	}
	return { text, words };
}

function modalityTokens(raw: unknown, modality: string): number | undefined {
	if (!Array.isArray(raw)) {
		return undefined;
	}
	let total: number | undefined;
	for (const entryValue of raw) {
		const entry = record(entryValue);
		if (
			typeof entry?.modality === "string" &&
			entry.modality.toLowerCase() === modality &&
			typeof entry.tokens === "number"
		) {
			total = (total ?? 0) + entry.tokens;
		}
	}
	return total;
}

/** Interactions `usage` -> token-based transcription usage. */
export function geminiTranscriptionUsage(
	raw: unknown,
): TranscriptionUsage | undefined {
	const usage = record(raw);
	if (!usage) {
		return undefined;
	}
	const input = nonNegativeInt(usage.total_input_tokens);
	const output = nonNegativeInt(usage.total_output_tokens);
	const total =
		nonNegativeInt(usage.total_tokens) ??
		(input === undefined && output === undefined
			? undefined
			: (input ?? 0) + (output ?? 0));
	if (total === undefined) {
		return undefined;
	}
	const audioTokens = modalityTokens(usage.input_tokens_by_modality, "audio");
	const textTokens = modalityTokens(usage.input_tokens_by_modality, "text");
	return {
		type: "tokens",
		...(input === undefined ? {} : { inputTokens: input }),
		...(output === undefined ? {} : { outputTokens: output }),
		totalTokens: total,
		...(audioTokens === undefined && textTokens === undefined
			? {}
			: {
					inputTokenDetails: {
						...(textTokens === undefined ? {} : { textTokens }),
						...(audioTokens === undefined ? {} : { audioTokens }),
					},
				}),
	};
}

/** The words' own span of the transcript, or the words joined when Gemini gives no indices. */
function spanText(transcript: string, words: GeminiTranscriptWord[]): string {
	const [first] = words;
	const last = words.at(-1);
	if (
		first?.startIndex !== undefined &&
		last?.endIndex !== undefined &&
		last.endIndex >= first.startIndex &&
		last.endIndex <= transcript.length
	) {
		return transcript.slice(first.startIndex, last.endIndex).trim();
	}
	return words.map((word) => word.text).join(" ");
}

/** Consecutive words by the same speaker, rendered as OpenAI `diarized_json` segments. */
export function diarizedSegments(
	transcript: string,
	words: GeminiTranscriptWord[],
): Record<string, unknown>[] {
	const turns: GeminiTranscriptWord[][] = [];
	for (const word of words) {
		const current = turns.at(-1);
		if (current && current[0]?.speaker === word.speaker) {
			current.push(word);
		} else {
			turns.push([word]);
		}
	}
	return turns.map((turn, index) => ({
		type: "transcript.text.segment",
		id: `seg_${String(index + 1).padStart(3, "0")}`,
		start: turn[0]?.start ?? 0,
		end: turn.at(-1)?.end ?? 0,
		text: spanText(transcript, turn),
		speaker: turn[0]?.speaker ?? "unknown",
	}));
}

const CUE_MAX_SECONDS = 6;
const CUE_MAX_CHARS = 84;
const CUE_MAX_GAP_SECONDS = 1;

/** Groups timed words into subtitle cues: sentence ends, pauses, and length close a cue. */
export function subtitleCues(
	transcript: string,
	words: GeminiTranscriptWord[],
): Array<{ start: number; end: number; text: string }> {
	const cues: GeminiTranscriptWord[][] = [];
	let current: GeminiTranscriptWord[] = [];
	for (const word of words) {
		const previous = current.at(-1);
		const [first] = current;
		if (
			previous &&
			first &&
			(word.start - previous.end > CUE_MAX_GAP_SECONDS ||
				word.end - first.start > CUE_MAX_SECONDS ||
				spanText(transcript, [...current, word]).length > CUE_MAX_CHARS)
		) {
			cues.push(current);
			current = [];
		}
		current.push(word);
		if (/[.!?…]["')\]]?$/.test(word.text)) {
			cues.push(current);
			current = [];
		}
	}
	if (current.length > 0) {
		cues.push(current);
	}
	return cues.map((cue) => ({
		start: cue[0]?.start ?? 0,
		end: cue.at(-1)?.end ?? 0,
		text: spanText(transcript, cue),
	}));
}

function timestamp(seconds: number, separator: "," | "."): string {
	const totalMs = Math.max(0, Math.round(seconds * 1000));
	const ms = totalMs % 1000;
	const totalSeconds = Math.floor(totalMs / 1000);
	const pad = (value: number, size = 2) => String(value).padStart(size, "0");
	return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}${separator}${pad(ms, 3)}`;
}

export function renderSubtitles(
	transcript: string,
	words: GeminiTranscriptWord[],
	format: "srt" | "vtt",
): string {
	const cues = subtitleCues(transcript, words);
	if (format === "vtt") {
		return `WEBVTT\n\n${cues
			.map(
				(cue) =>
					`${timestamp(cue.start, ".")} --> ${timestamp(cue.end, ".")}\n${cue.text}\n\n`,
			)
			.join("")}`;
	}
	return cues
		.map(
			(cue, index) =>
				`${index + 1}\n${timestamp(cue.start, ",")} --> ${timestamp(cue.end, ",")}\n${cue.text}\n\n`,
		)
		.join("");
}

const FAILED_STATUSES = new Set([
	"failed",
	"cancelled",
	"incomplete",
	"requires_action",
	"requires_continuation",
]);

/** Interaction -> canonical transcription, shaped for the requested format. */
export function parseGeminiTranscription(
	raw: unknown,
	req: CanonicalTranscriptionRequest,
): CanonicalTranscriptionResponse {
	const interaction = record(raw);
	if (!interaction) {
		throw new GatewayError({
			class: "server",
			code: "upstream_protocol_error",
			message: "Gemini transcription response was not a JSON object",
			provider: { body: raw },
			failureKind: "transient",
			deploymentHealth: "penalize",
		});
	}
	const status =
		typeof interaction.status === "string"
			? interaction.status.toLowerCase()
			: undefined;
	if (status !== undefined && FAILED_STATUSES.has(status)) {
		throw new GatewayError({
			class: "server",
			message: `Gemini transcription interaction ended with status ${status}`,
			provider: { body: interaction },
			failureKind: "transient",
		});
	}
	const { text, words } = geminiTranscript(interaction);
	const usage = geminiTranscriptionUsage(interaction.usage);
	const response: CanonicalTranscriptionResponse = {
		text,
		...(usage ? { usage } : {}),
	};
	if (req.responseFormat === "srt" || req.responseFormat === "vtt") {
		response.text = renderSubtitles(text, words, req.responseFormat);
	} else if (req.responseFormat === "diarized_json") {
		response.segments = diarizedSegments(text, words);
	} else if (
		req.responseFormat === "verbose_json" &&
		(req.timestampGranularities ?? []).includes("word")
	) {
		response.words = words.map((word) => ({
			word: word.text,
			start: word.start,
			end: word.end,
		}));
	}
	return response;
}
