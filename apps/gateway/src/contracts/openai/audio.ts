import * as z from "zod/v4";

import type {
	CanonicalTranscriptionStreamEvent,
	CanonicalTranscriptionResponse,
	CanonicalTranscriptionRequest,
	CanonicalAudioInput,
	TranscriptionUsage,
} from "#core/audio.ts";

/**
 * Scalar fields of the /v1/audio/transcriptions multipart (without `file`, validated separately).
 * What is not first-class supported (e.g. chunking_strategy) travels via `extra_body`.
 */
export const transcriptionFieldsSchema = z
	.object({
		model: z.string().min(1),
		language: z.string().optional(),
		prompt: z.string().optional(),
		temperature: z.number().min(0).max(1).optional(),
		response_format: z
			.enum(["json", "text", "srt", "verbose_json", "vtt"])
			.default("json"),
		timestamp_granularities: z.array(z.enum(["word", "segment"])).optional(),
		include: z.array(z.string()).optional(),
		stream: z.boolean().optional(),
		extra_body: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export type TranscriptionFields = z.infer<typeof transcriptionFieldsSchema>;

export function transcriptionToCanonical(
	fields: TranscriptionFields,
	file: CanonicalAudioInput,
): CanonicalTranscriptionRequest {
	return {
		model: fields.model,
		file,
		responseFormat: fields.response_format,
		stream: fields.stream ?? false,
		...(fields.language !== undefined ? { language: fields.language } : {}),
		...(fields.prompt !== undefined ? { prompt: fields.prompt } : {}),
		...(fields.temperature !== undefined
			? { temperature: fields.temperature }
			: {}),
		...(fields.timestamp_granularities !== undefined
			? { timestampGranularities: fields.timestamp_granularities }
			: {}),
		...(fields.include !== undefined ? { include: fields.include } : {}),
		...(fields.extra_body !== undefined
			? { extraBody: fields.extra_body }
			: {}),
	};
}

function renderUsage(usage: TranscriptionUsage): Record<string, unknown> {
	const details = usage.inputTokenDetails;
	return {
		type: "tokens",
		...(usage.inputTokens !== undefined
			? { input_tokens: usage.inputTokens }
			: {}),
		...(details
			? {
					input_token_details: {
						...(details.textTokens !== undefined
							? { text_tokens: details.textTokens }
							: {}),
						...(details.audioTokens !== undefined
							? { audio_tokens: details.audioTokens }
							: {}),
					},
				}
			: {}),
		...(usage.outputTokens !== undefined
			? { output_tokens: usage.outputTokens }
			: {}),
		...(usage.totalTokens !== undefined
			? { total_tokens: usage.totalTokens }
			: {}),
	};
}

/**
 * Renders to the OpenAI contract according to the requested format. `text`/`srt`/`vtt` return a STRING
 * (plain-text body); `json`/`verbose_json` an object. The endpoint decides the content-type.
 */
export function toOpenAITranscriptionResponse(
	resp: CanonicalTranscriptionResponse,
	format: CanonicalTranscriptionRequest["responseFormat"],
): Record<string, unknown> | string {
	if (format === "text" || format === "srt" || format === "vtt")
		return resp.text;
	if (format === "verbose_json") {
		return {
			task: "transcribe",
			...(resp.language !== undefined ? { language: resp.language } : {}),
			...(resp.duration !== undefined ? { duration: resp.duration } : {}),
			text: resp.text,
			...(resp.segments !== undefined ? { segments: resp.segments } : {}),
			...(resp.words !== undefined ? { words: resp.words } : {}),
			...(resp.usage ? { usage: renderUsage(resp.usage) } : {}),
		};
	}
	return {
		text: resp.text,
		...(resp.logprobs !== undefined ? { logprobs: resp.logprobs } : {}),
		...(resp.usage ? { usage: renderUsage(resp.usage) } : {}),
	};
}

export function toOpenAITranscriptionEvent(
	event: CanonicalTranscriptionStreamEvent,
): Record<string, unknown> {
	if (event.kind === "delta") {
		return {
			type: "transcript.text.delta",
			delta: event.delta,
			...(event.logprobs !== undefined ? { logprobs: event.logprobs } : {}),
		};
	}
	return {
		type: "transcript.text.done",
		text: event.text,
		...(event.logprobs !== undefined ? { logprobs: event.logprobs } : {}),
		...(event.usage ? { usage: renderUsage(event.usage) } : {}),
	};
}
