import { GatewayError } from "#core/errors.ts";
import { parseSSE } from "#core/sse.ts";
import { openAsBlob } from "node:fs";

import type {
	CanonicalTranscriptionStreamEvent,
	CanonicalTranscriptionResponse,
	CanonicalTranscriptionRequest,
	TranscriptionUsage,
} from "#core/audio.ts";

/** Fields the gateway manages; `extra_body` cannot overwrite them. */
const FORM_MANAGED = new Set([
	"file",
	"model",
	"language",
	"prompt",
	"temperature",
	"response_format",
	"timestamp_granularities",
	"timestamp_granularities[]",
	"include",
	"include[]",
	"stream",
]);

function formValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return JSON.stringify(value);
}

/**
 * Builds the multipart toward /audio/transcriptions. `includeModel: false` omits the `model` field
 * (Azure legacy carries the deployment in the URL, not the body).
 */
export async function buildTranscriptionForm(
	req: CanonicalTranscriptionRequest,
	upstreamModel: string,
	options?: { includeModel?: boolean },
): Promise<FormData> {
	const form = new FormData();
	const blob = await openAsBlob(req.file.path, { type: req.file.mimeType });
	// FormData.append's filename arg is honored by Node but ignored by Bun (which derives the name
	// from the blob's backing path); wrap in a File so the upstream multipart name is deterministic.
	const file = new File([blob], req.file.filename, { type: req.file.mimeType });
	form.append("file", file);
	if (options?.includeModel !== false) form.append("model", upstreamModel);
	form.append("response_format", req.responseFormat);
	if (req.language !== undefined) form.append("language", req.language);
	if (req.prompt !== undefined) form.append("prompt", req.prompt);
	if (req.temperature !== undefined)
		form.append("temperature", String(req.temperature));
	for (const granularity of req.timestampGranularities ?? []) {
		form.append("timestamp_granularities[]", granularity);
	}
	for (const item of req.include ?? []) form.append("include[]", item);
	if (req.stream) form.append("stream", "true");
	// Arbitrary fields (e.g. chunking_strategy) via extra_body; they cannot overwrite managed ones.
	for (const [key, value] of Object.entries(req.extraBody ?? {})) {
		if (FORM_MANAGED.has(key)) {
			throw new GatewayError({
				class: "bad_request",
				message: `extra_body.${key} collides with a managed transcription field`,
				param: `extra_body.${key}`,
			});
		}
		form.append(key, formValue(value));
	}
	return form;
}

function parseUsage(raw: unknown): TranscriptionUsage | undefined {
	if (raw === null || typeof raw !== "object") return undefined;
	const u = raw as {
		input_tokens?: number;
		output_tokens?: number;
		total_tokens?: number;
		input_token_details?: { text_tokens?: number; audio_tokens?: number };
	};
	if (typeof u.total_tokens !== "number") return undefined;
	const details = u.input_token_details;
	return {
		type: "tokens",
		...(typeof u.input_tokens === "number"
			? { inputTokens: u.input_tokens }
			: {}),
		...(typeof u.output_tokens === "number"
			? { outputTokens: u.output_tokens }
			: {}),
		totalTokens: u.total_tokens,
		...(details
			? {
					inputTokenDetails: {
						...(typeof details.text_tokens === "number"
							? { textTokens: details.text_tokens }
							: {}),
						...(typeof details.audio_tokens === "number"
							? { audioTokens: details.audio_tokens }
							: {}),
					},
				}
			: {}),
	};
}

/** Plain text (text/srt/vtt) -> `{text}`; object (json/verbose_json) -> parsed fields. */
export function parseTranscriptionResponse(
	raw: unknown,
): CanonicalTranscriptionResponse {
	if (typeof raw === "string") return { text: raw };
	const body = (raw ?? {}) as Record<string, unknown>;
	const resp: CanonicalTranscriptionResponse = {
		text: typeof body.text === "string" ? body.text : "",
	};
	if (typeof body.language === "string") resp.language = body.language;
	if (typeof body.duration === "number") resp.duration = body.duration;
	if (Array.isArray(body.segments))
		resp.segments = body.segments as Record<string, unknown>[];
	if (Array.isArray(body.words))
		resp.words = body.words as Record<string, unknown>[];
	if (body.logprobs !== undefined) resp.logprobs = body.logprobs;
	const usage = parseUsage(body.usage);
	if (usage) resp.usage = usage;
	return resp;
}

/** gpt-4o-transcribe SSE: transcript.text.delta / transcript.text.done -> canonical events. */
export async function* parseTranscriptionStream(
	stream: ReadableStream<Uint8Array>,
	options?: {
		onUnknownEvent?: (type: string) => void;
		onTransportTerminator?: (terminator: "done_marker") => void;
	},
): AsyncIterable<CanonicalTranscriptionStreamEvent> {
	for await (const sse of parseSSE(stream)) {
		if (sse.data === "[DONE]") {
			options?.onTransportTerminator?.("done_marker");
			return;
		}
		let raw: Record<string, unknown>;
		try {
			raw = JSON.parse(sse.data) as Record<string, unknown>;
		} catch (cause) {
			throw new GatewayError({
				class: "server",
				code: "upstream_protocol_error",
				message: "Transcription upstream emitted malformed JSON",
				provider: { body: sse.data },
				cause,
			});
		}
		if (raw.error) {
			throw new GatewayError({
				class: "server",
				message: "Transcription upstream stream failed",
				provider: { body: raw },
			});
		}
		const type = typeof raw.type === "string" ? raw.type : "";
		if (type === "transcript.text.delta") {
			yield {
				kind: "delta",
				delta: typeof raw.delta === "string" ? raw.delta : "",
				...(raw.logprobs !== undefined ? { logprobs: raw.logprobs } : {}),
			};
		} else if (type === "transcript.text.done") {
			const usage = parseUsage(raw.usage);
			yield {
				kind: "done",
				text: typeof raw.text === "string" ? raw.text : "",
				...(usage ? { usage } : {}),
				...(raw.logprobs !== undefined ? { logprobs: raw.logprobs } : {}),
			};
		} else options?.onUnknownEvent?.(type || "missing_type");
	}
}
