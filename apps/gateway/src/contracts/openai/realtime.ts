import type { RealtimeInputAudioFormat } from "#audio/pcm.ts";
import { randomBytes } from "node:crypto";
import { z } from "zod/v4";

import type {
	CanonicalRealtimeTranscriptionConfig,
	RealtimeTurnDetection,
	RealtimeUsage,
} from "#core/realtime.ts";

/**
 * OpenAI's Realtime API in transcription mode (`/v1/realtime?intent=transcription`), the GA shape:
 * `session.update` with `session.type: "transcription"`, `input_audio_buffer.*` client events, and
 * `conversation.item.input_audio_transcription.*` server events.
 *
 * Bifrozz adds `transcription_mode` (verbatim/smart) beside `keywords`/`languages` in
 * `audio.input.transcription`, and an opt-in `conversation.item.input_audio_transcription.interim`
 * event (`include: ["item.input_audio_transcription.interim"]`) that carries a provider's full
 * revisable hypothesis, which append-only deltas cannot express.
 */

export const INTERIM_INCLUDE = "item.input_audio_transcription.interim";

const keyword = z
	.string()
	.regex(/^[^<>\r\n]*$/, "Keywords must not contain <, >, CR or LF");

const formatSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("audio/pcm"),
		rate: z.union([z.literal(24_000), z.literal(16_000)]).default(24_000),
	}),
	z.object({ type: z.literal("audio/pcmu") }),
	z.object({ type: z.literal("audio/pcma") }),
]);

const transcriptionSchema = z
	.object({
		model: z.string().min(1).optional(),
		language: z.string().min(1).optional(),
		languages: z.array(z.string().min(1)).optional(),
		keywords: z.array(keyword).optional(),
		prompt: z.string().optional(),
		delay: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
		transcription_mode: z.enum(["verbatim", "smart"]).optional(),
	})
	.refine(
		(value) => value.language === undefined || value.languages === undefined,
		{ message: "Use language or languages, not both", path: ["languages"] },
	);

const turnDetectionSchema = z
	.object({ type: z.enum(["server_vad", "semantic_vad"]) })
	.loose()
	.nullable();

export const realtimeTranscriptionSessionSchema = z.object({
	type: z.literal("transcription"),
	audio: z
		.object({
			input: z
				.object({
					format: formatSchema.optional(),
					transcription: transcriptionSchema.optional(),
					turn_detection: turnDetectionSchema.optional(),
					noise_reduction: z.unknown().optional(),
				})
				.optional(),
		})
		.optional(),
	include: z.array(z.string()).nullable().optional(),
});

const clientEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("session.update"),
		event_id: z.string().optional(),
		session: realtimeTranscriptionSessionSchema,
	}),
	z.object({
		type: z.literal("input_audio_buffer.append"),
		event_id: z.string().optional(),
		audio: z.string(),
	}),
	z.object({
		type: z.literal("input_audio_buffer.commit"),
		event_id: z.string().optional(),
	}),
	z.object({
		type: z.literal("input_audio_buffer.clear"),
		event_id: z.string().optional(),
	}),
]);

export type RealtimeClientEvent = z.infer<typeof clientEventSchema>;
export type RealtimeSessionUpdate = z.infer<
	typeof realtimeTranscriptionSessionSchema
>;

export class RealtimeClientEventError extends Error {
	readonly code: string;
	readonly param: string | null;
	readonly eventId: string | null;

	constructor(
		message: string,
		code: string,
		param: string | null,
		clientEventId: string | null,
	) {
		super(message);
		this.code = code;
		this.param = param;
		this.eventId = clientEventId;
	}
}

/** Parses one client message, or explains in OpenAI's error vocabulary why it is invalid. */
export function parseRealtimeClientEvent(raw: unknown): RealtimeClientEvent {
	const clientEventId =
		raw !== null &&
		typeof raw === "object" &&
		typeof (raw as { event_id?: unknown }).event_id === "string"
			? (raw as { event_id: string }).event_id
			: null;
	const parsed = clientEventSchema.safeParse(raw);
	if (parsed.success) {
		return parsed.data;
	}
	const type =
		raw !== null && typeof raw === "object"
			? (raw as { type?: unknown }).type
			: undefined;
	if (typeof type !== "string") {
		throw new RealtimeClientEventError(
			"The 'type' field is missing.",
			"invalid_event",
			"type",
			clientEventId,
		);
	}
	const [issue] = parsed.error.issues;
	const path = issue?.path.map(String).join(".") ?? "";
	if (path === "type" || path === "") {
		throw new RealtimeClientEventError(
			`Unsupported event type '${type}' for a transcription session.`,
			"invalid_event",
			"type",
			clientEventId,
		);
	}
	throw new RealtimeClientEventError(
		`Invalid '${path}': ${issue?.message ?? "invalid value"}.`,
		"invalid_value",
		path,
		clientEventId,
	);
}

/** The effective session after a `session.update`, merged over the previous one. */
export interface RealtimeSessionState {
	id: string;
	format: RealtimeInputAudioFormat;
	transcription: z.infer<typeof transcriptionSchema> | null;
	/** `null` = the client commits turns itself. */
	turnDetection: Record<string, unknown> | null;
	noiseReduction: unknown;
	include: string[];
}

export function newRealtimeSessionState(): RealtimeSessionState {
	return {
		id: `sess_${randomBytes(12).toString("base64url")}`,
		format: { type: "audio/pcm", rate: 24_000 },
		transcription: null,
		turnDetection: {
			type: "server_vad",
			threshold: 0.5,
			prefix_padding_ms: 300,
			silence_duration_ms: 500,
		},
		noiseReduction: null,
		include: [],
	};
}

/** Applies a `session.update`: fields it sends replace the current ones, omitted ones stay. */
export function applySessionUpdate(
	state: RealtimeSessionState,
	update: RealtimeSessionUpdate,
): RealtimeSessionState {
	const input = update.audio?.input;
	return {
		...state,
		...(input?.format ? { format: input.format } : {}),
		...(input?.transcription
			? {
					transcription: {
						...(input.transcription.model === undefined &&
						state.transcription?.model
							? { model: state.transcription.model }
							: {}),
						...input.transcription,
					},
				}
			: {}),
		...(input?.turn_detection === undefined
			? {}
			: { turnDetection: input.turn_detection }),
		...(input?.noise_reduction === undefined
			? {}
			: { noiseReduction: input.noise_reduction }),
		...(update.include === undefined ? {} : { include: update.include ?? [] }),
	};
}

export function turnDetectionOf(
	state: RealtimeSessionState,
): RealtimeTurnDetection {
	return state.turnDetection === null ? "manual" : "server_vad";
}

/** The canonical configuration a provider session is opened with. */
export function realtimeConfigOf(
	state: RealtimeSessionState,
): CanonicalRealtimeTranscriptionConfig | null {
	const { transcription } = state;
	if (!transcription?.model) {
		return null;
	}
	return {
		model: transcription.model,
		turnDetection: turnDetectionOf(state),
		...(transcription.language === undefined
			? {}
			: { language: transcription.language }),
		...(transcription.languages === undefined
			? {}
			: { languages: transcription.languages }),
		...(transcription.keywords === undefined
			? {}
			: { keywords: transcription.keywords }),
		...(transcription.transcription_mode === undefined
			? {}
			: { mode: transcription.transcription_mode }),
	};
}

/* ------------------------------------------------------------------ server events */

export function eventId(): string {
	return `event_${randomBytes(12).toString("base64url")}`;
}

export function itemId(): string {
	return `item_${randomBytes(12).toString("base64url")}`;
}

export function renderSession(
	state: RealtimeSessionState,
): Record<string, unknown> {
	return {
		object: "realtime.transcription_session",
		type: "transcription",
		id: state.id,
		audio: {
			input: {
				format: state.format,
				transcription: state.transcription,
				noise_reduction: state.noiseReduction,
				turn_detection: state.turnDetection,
			},
		},
		include: state.include.length > 0 ? state.include : null,
	};
}

export function renderRealtimeUsage(
	usage: RealtimeUsage,
): Record<string, unknown> {
	return {
		type: "tokens",
		input_tokens: usage.inputTokens,
		...(usage.audioTokens === undefined && usage.textTokens === undefined
			? {}
			: {
					input_token_details: {
						...(usage.textTokens === undefined
							? {}
							: { text_tokens: usage.textTokens }),
						...(usage.audioTokens === undefined
							? {}
							: { audio_tokens: usage.audioTokens }),
					},
				}),
		output_tokens: usage.outputTokens,
		total_tokens: usage.totalTokens,
	};
}

export function renderUserAudioItem(id: string): Record<string, unknown> {
	return {
		id,
		type: "message",
		object: "realtime.item",
		status: "completed",
		role: "user",
		content: [{ type: "input_audio", transcript: null }],
	};
}

export function realtimeErrorEvent(error: {
	type: string;
	code: string | null;
	message: string;
	param: string | null;
	eventId?: string | null;
}): Record<string, unknown> {
	return {
		type: "error",
		event_id: eventId(),
		error: {
			type: error.type,
			code: error.code,
			message: error.message,
			param: error.param,
			event_id: error.eventId ?? null,
		},
	};
}
