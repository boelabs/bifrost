import type { RealtimeOutputAudioFormat } from "#audio/pcm.ts";
import { randomBytes } from "node:crypto";
import { z } from "zod/v4";

import type {
	CanonicalRealtimeConversationConfig,
	RealtimeFunctionDeclaration,
	RealtimeVadConfig,
	RealtimeUsage,
} from "#core/realtime.ts";

import { RealtimeClientEventError, eventId } from "./realtime.ts";

/**
 * OpenAI's Realtime API in conversation mode (`/v1/realtime?model=`), the GA shape: a session of
 * `type: "realtime"` that listens, answers in speech or text, and calls functions.
 *
 * Bifrozz extensions: a `{type: "google_search"}` tool (the provider's own web search),
 * `session.translation` for speech-to-speech translation models, and `transcription_mode`/
 * `keywords`/`languages` beside the input transcription settings.
 */

const keyword = z
	.string()
	.regex(/^[^<>\r\n]*$/, "Keywords must not contain <, >, CR or LF");

const audioFormatSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("audio/pcm"),
		rate: z.union([z.literal(24_000), z.literal(16_000)]).default(24_000),
	}),
	z.object({ type: z.literal("audio/pcmu") }),
	z.object({ type: z.literal("audio/pcma") }),
]);

const outputFormatSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("audio/pcm"),
		rate: z.literal(24_000).default(24_000),
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
	})
	.nullable();

const turnDetectionSchema = z
	.discriminatedUnion("type", [
		z.object({
			type: z.literal("server_vad"),
			threshold: z.number().min(0).max(1).optional(),
			prefix_padding_ms: z.int().nonnegative().optional(),
			silence_duration_ms: z.int().nonnegative().optional(),
			idle_timeout_ms: z.int().min(5000).max(30_000).nullable().optional(),
			create_response: z.boolean().optional(),
			interrupt_response: z.boolean().optional(),
		}),
		z.object({
			type: z.literal("semantic_vad"),
			eagerness: z.enum(["low", "medium", "high", "auto"]).optional(),
			create_response: z.boolean().optional(),
			interrupt_response: z.boolean().optional(),
		}),
	])
	.nullable();

const toolSchema = z.union([
	z.object({
		type: z.literal("function"),
		name: z.string().min(1).max(128),
		description: z.string().optional(),
		parameters: z.record(z.string(), z.unknown()).optional(),
	}),
	z.object({ type: z.literal("google_search") }),
	z.object({ type: z.literal("mcp") }).loose(),
]);

const toolChoiceSchema = z.union([
	z.enum(["none", "auto", "required"]),
	z.object({ type: z.literal("function"), name: z.string() }),
	z.object({ type: z.literal("mcp") }).loose(),
]);

export const realtimeConversationSessionSchema = z.object({
	type: z.literal("realtime"),
	model: z.string().min(1).optional(),
	instructions: z.string().optional(),
	output_modalities: z
		.array(z.enum(["audio", "text"]))
		.length(1, "Request exactly one of audio or text.")
		.optional(),
	audio: z
		.object({
			input: z
				.object({
					format: audioFormatSchema.optional(),
					transcription: transcriptionSchema.optional(),
					turn_detection: turnDetectionSchema.optional(),
					noise_reduction: z.unknown().optional(),
				})
				.optional(),
			output: z
				.object({
					format: outputFormatSchema.optional(),
					voice: z
						.union([z.string().min(1), z.object({ id: z.string() })])
						.optional(),
					speed: z.number().min(0.25).max(1.5).optional(),
				})
				.optional(),
		})
		.optional(),
	tools: z.array(toolSchema).optional(),
	tool_choice: toolChoiceSchema.optional(),
	max_output_tokens: z.union([z.int().min(1), z.literal("inf")]).optional(),
	reasoning: z
		.object({
			effort: z.enum(["minimal", "low", "medium", "high", "xhigh"]).optional(),
		})
		.nullable()
		.optional(),
	parallel_tool_calls: z.boolean().optional(),
	truncation: z
		.union([
			z.enum(["auto", "disabled"]),
			z.object({ type: z.literal("retention_ratio") }).loose(),
		])
		.optional(),
	tracing: z.unknown().optional(),
	prompt: z.unknown().optional(),
	include: z.array(z.string()).nullable().optional(),
	translation: z
		.object({
			target_language: z.string().min(1),
			echo_target_language: z.boolean().optional(),
		})
		.nullable()
		.optional(),
});

const textPart = z.object({ type: z.literal("input_text"), text: z.string() });

const itemSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("message"),
		id: z.string().max(32).optional(),
		object: z.literal("realtime.item").optional(),
		status: z.string().optional(),
		role: z.enum(["system", "user", "assistant"]),
		content: z
			.array(
				z.discriminatedUnion("type", [
					textPart,
					z.object({
						type: z.literal("input_audio"),
						audio: z.string(),
						transcript: z.string().nullable().optional(),
					}),
					z.object({
						type: z.literal("input_image"),
						image_url: z.string(),
						detail: z.enum(["auto", "low", "high"]).optional(),
					}),
					z.object({ type: z.literal("output_text"), text: z.string() }),
					z.object({
						type: z.literal("output_audio"),
						audio: z.string().optional(),
						transcript: z.string(),
					}),
				]),
			)
			.min(1),
	}),
	z.object({
		type: z.literal("function_call"),
		id: z.string().max(32).optional(),
		object: z.literal("realtime.item").optional(),
		status: z.string().optional(),
		call_id: z.string().optional(),
		name: z.string(),
		arguments: z.string(),
	}),
	z.object({
		type: z.literal("function_call_output"),
		id: z.string().max(32).optional(),
		object: z.literal("realtime.item").optional(),
		status: z.string().optional(),
		call_id: z.string(),
		output: z.string(),
	}),
]);

const responseSchema = z
	.object({
		output_modalities: z.array(z.enum(["audio", "text"])).optional(),
		instructions: z.string().optional(),
		tools: z.array(z.unknown()).optional(),
		tool_choice: z.unknown().optional(),
		max_output_tokens: z.union([z.int().min(1), z.literal("inf")]).optional(),
		conversation: z.union([z.literal("auto"), z.literal("none")]).optional(),
		input: z.array(z.unknown()).optional(),
		metadata: z.record(z.string().max(64), z.string().max(512)).optional(),
		audio: z
			.object({
				output: z
					.object({
						format: z.unknown().optional(),
						voice: z.unknown().optional(),
					})
					.optional(),
			})
			.optional(),
		reasoning: z.unknown().optional(),
		parallel_tool_calls: z.boolean().optional(),
		prompt: z.unknown().optional(),
	})
	.optional();

const withEventId = { event_id: z.string().max(512).optional() };

const clientEventSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("session.update"),
		...withEventId,
		session: realtimeConversationSessionSchema,
	}),
	z.object({
		type: z.literal("input_audio_buffer.append"),
		...withEventId,
		audio: z.string(),
	}),
	z.object({ type: z.literal("input_audio_buffer.commit"), ...withEventId }),
	z.object({ type: z.literal("input_audio_buffer.clear"), ...withEventId }),
	z.object({
		type: z.literal("conversation.item.create"),
		...withEventId,
		previous_item_id: z.string().nullable().optional(),
		item: itemSchema,
	}),
	z.object({
		type: z.literal("conversation.item.retrieve"),
		...withEventId,
		item_id: z.string(),
	}),
	z.object({
		type: z.literal("conversation.item.truncate"),
		...withEventId,
		item_id: z.string(),
		content_index: z.int().nonnegative(),
		audio_end_ms: z.int().nonnegative(),
	}),
	z.object({
		type: z.literal("conversation.item.delete"),
		...withEventId,
		item_id: z.string(),
	}),
	z.object({
		type: z.literal("response.create"),
		...withEventId,
		response: responseSchema,
	}),
	z.object({
		type: z.literal("response.cancel"),
		...withEventId,
		response_id: z.string().optional(),
	}),
	z.object({ type: z.literal("output_audio_buffer.clear"), ...withEventId }),
]);

export type RealtimeConversationClientEvent = z.infer<typeof clientEventSchema>;
export type RealtimeConversationSessionUpdate = z.infer<
	typeof realtimeConversationSessionSchema
>;
export type RealtimeConversationItem = z.infer<typeof itemSchema>;
export type RealtimeResponseParams = NonNullable<
	z.infer<typeof responseSchema>
>;
type RealtimeTool = z.infer<typeof toolSchema>;

/** Parses one client message, or explains in OpenAI's error vocabulary why it is invalid. */
export function parseRealtimeConversationEvent(
	raw: unknown,
): RealtimeConversationClientEvent {
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
			`Invalid value: '${type}'.`,
			"invalid_value",
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

/* ------------------------------------------------------------------ session state */

export interface RealtimeConversationState {
	id: string;
	/** The public model, fixed for the connection. */
	model: string;
	instructions: string;
	outputModality: "audio" | "text";
	inputFormat: z.infer<typeof audioFormatSchema>;
	outputFormat: RealtimeOutputAudioFormat;
	transcription: z.infer<typeof transcriptionSchema>;
	noiseReduction: unknown;
	turnDetection: z.infer<typeof turnDetectionSchema>;
	voice: string | null;
	speed: number;
	tools: RealtimeTool[];
	toolChoice: z.infer<typeof toolChoiceSchema>;
	maxOutputTokens: number | "inf";
	reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | null;
	truncation: z.infer<typeof realtimeConversationSessionSchema>["truncation"];
	tracing: unknown;
	prompt: unknown;
	include: string[];
	translation: {
		target_language: string;
		echo_target_language?: boolean | undefined;
	} | null;
	/** Whether any audio was spoken yet; OpenAI locks the voice after that. */
	spoke: boolean;
}

export function newRealtimeConversationState(
	model: string,
): RealtimeConversationState {
	return {
		id: `sess_${randomBytes(12).toString("base64url")}`,
		model,
		instructions: "",
		outputModality: "audio",
		inputFormat: { type: "audio/pcm", rate: 24_000 },
		outputFormat: { type: "audio/pcm", rate: 24_000 },
		transcription: null,
		noiseReduction: null,
		turnDetection: {
			type: "server_vad",
			threshold: 0.5,
			prefix_padding_ms: 300,
			silence_duration_ms: 500,
			idle_timeout_ms: null,
			create_response: true,
			interrupt_response: true,
		},
		voice: null,
		speed: 1,
		tools: [],
		toolChoice: "auto",
		maxOutputTokens: "inf",
		reasoningEffort: null,
		truncation: "auto",
		tracing: null,
		prompt: null,
		include: [],
		translation: null,
		spoke: false,
	};
}

function unsupportedField(
	param: string,
	message: string,
	clientEventId: string | null,
): never {
	throw new RealtimeClientEventError(
		message,
		"unsupported_parameter",
		param,
		clientEventId,
	);
}

/** Applies a `session.update`: fields it sends replace the current ones, omitted ones stay. */
export function applyConversationSessionUpdate(
	state: RealtimeConversationState,
	update: RealtimeConversationSessionUpdate,
	clientEventId: string | null,
): RealtimeConversationState {
	if (update.model !== undefined && update.model !== state.model) {
		unsupportedField(
			"session.model",
			"The model of a realtime session cannot change; open a new connection for another model.",
			clientEventId,
		);
	}
	const input = update.audio?.input;
	const output = update.audio?.output;
	let { voice } = state;
	if (output?.voice !== undefined) {
		if (typeof output.voice !== "string") {
			unsupportedField(
				"session.audio.output.voice",
				"Custom voices are not supported; use one of the model's prebuilt voices.",
				clientEventId,
			);
		}
		({ voice } = output);
	}
	if (state.spoke && voice !== state.voice) {
		unsupportedField(
			"session.audio.output.voice",
			"The voice cannot change once the model has spoken in this session.",
			clientEventId,
		);
	}
	let { turnDetection } = state;
	const nextTurnDetection = input?.turn_detection;
	if (nextTurnDetection === null) {
		turnDetection = null;
	} else if (nextTurnDetection !== undefined) {
		// A partial update of the same detector keeps the settings it does not mention.
		turnDetection =
			nextTurnDetection.type === turnDetection?.type
				? { ...turnDetection, ...nextTurnDetection }
				: nextTurnDetection;
	}
	return {
		...state,
		...(update.instructions === undefined
			? {}
			: { instructions: update.instructions }),
		...(update.output_modalities === undefined
			? {}
			: { outputModality: update.output_modalities[0] ?? "audio" }),
		...(input?.format ? { inputFormat: input.format } : {}),
		...(output?.format ? { outputFormat: output.format } : {}),
		...(input?.transcription === undefined
			? {}
			: { transcription: input.transcription }),
		...(input?.noise_reduction === undefined
			? {}
			: { noiseReduction: input.noise_reduction }),
		turnDetection,
		voice,
		...(output?.speed === undefined ? {} : { speed: output.speed }),
		...(update.tools === undefined ? {} : { tools: update.tools }),
		...(update.tool_choice === undefined
			? {}
			: { toolChoice: update.tool_choice }),
		...(update.max_output_tokens === undefined
			? {}
			: { maxOutputTokens: update.max_output_tokens }),
		...(update.reasoning === undefined
			? {}
			: { reasoningEffort: update.reasoning?.effort ?? null }),
		...(update.truncation === undefined
			? {}
			: { truncation: update.truncation }),
		...(update.tracing === undefined ? {} : { tracing: update.tracing }),
		...(update.prompt === undefined ? {} : { prompt: update.prompt }),
		...(update.include === undefined ? {} : { include: update.include ?? [] }),
		...(update.translation === undefined
			? {}
			: { translation: update.translation }),
	};
}

function vadOf(
	turnDetection: RealtimeConversationState["turnDetection"],
): RealtimeVadConfig | null {
	if (!turnDetection) {
		return null;
	}
	const common = {
		interruptResponse: turnDetection.interrupt_response ?? true,
		createResponse: turnDetection.create_response ?? true,
	};
	if (turnDetection.type === "semantic_vad") {
		return {
			type: "semantic_vad",
			...common,
			...(turnDetection.eagerness === undefined
				? {}
				: { eagerness: turnDetection.eagerness }),
		};
	}
	return {
		type: "server_vad",
		...common,
		...(turnDetection.threshold === undefined
			? {}
			: { threshold: turnDetection.threshold }),
		...(turnDetection.prefix_padding_ms === undefined
			? {}
			: { prefixPaddingMs: turnDetection.prefix_padding_ms }),
		...(turnDetection.silence_duration_ms === undefined
			? {}
			: { silenceDurationMs: turnDetection.silence_duration_ms }),
		...(turnDetection.idle_timeout_ms == null
			? {}
			: { idleTimeoutMs: turnDetection.idle_timeout_ms }),
	};
}

/**
 * The canonical configuration a provider session is opened with. Settings no provider honours are
 * refused here; what depends on the model is checked against its catalog profile afterwards.
 */
export function conversationConfigOf(
	state: RealtimeConversationState,
): CanonicalRealtimeConversationConfig {
	if (state.prompt !== null && state.prompt !== undefined) {
		unsupportedField(
			"session.prompt",
			"Stored prompts are not supported; send instructions instead.",
			null,
		);
	}
	if (typeof state.truncation === "object" && state.truncation !== null) {
		unsupportedField(
			"session.truncation",
			"Only truncation 'auto' or 'disabled' is supported.",
			null,
		);
	}
	const functions: RealtimeFunctionDeclaration[] = [];
	let googleSearch = false;
	for (const [index, tool] of state.tools.entries()) {
		if (tool.type === "function") {
			functions.push({
				name: tool.name,
				...(tool.description === undefined
					? {}
					: { description: tool.description }),
				...(tool.parameters === undefined
					? {}
					: { parameters: tool.parameters }),
			});
		} else if (tool.type === "google_search") {
			googleSearch = true;
		} else {
			unsupportedField(
				`session.tools.${index}`,
				"MCP tools are not supported in realtime sessions.",
				null,
			);
		}
	}
	const { toolChoice } = state;
	if (toolChoice !== "auto" && toolChoice !== "none") {
		unsupportedField(
			"session.tool_choice",
			"Only tool_choice 'auto' or 'none' is supported.",
			null,
		);
	}
	const { transcription } = state;
	const languages =
		transcription?.languages ??
		(transcription?.language === undefined
			? undefined
			: [transcription.language]);
	return {
		model: state.model,
		...(state.instructions === "" ? {} : { instructions: state.instructions }),
		outputModality: state.outputModality,
		...(state.voice === null ? {} : { voice: state.voice }),
		...(state.speed === 1 ? {} : { speed: state.speed }),
		vad: vadOf(state.turnDetection),
		inputTranscription: transcription
			? {
					...(transcription.model === undefined
						? {}
						: { model: transcription.model }),
					...(languages ? { languages } : {}),
					...(transcription.keywords?.length
						? { keywords: transcription.keywords }
						: {}),
				}
			: null,
		tools: functions,
		toolChoice,
		googleSearch,
		...(state.maxOutputTokens === "inf"
			? {}
			: { maxOutputTokens: state.maxOutputTokens }),
		...(state.reasoningEffort
			? { reasoningEffort: state.reasoningEffort }
			: {}),
		truncation: state.truncation === "disabled" ? "disabled" : "auto",
		...(state.translation
			? {
					translation: {
						targetLanguage: state.translation.target_language,
						...(state.translation.echo_target_language === undefined
							? {}
							: {
									echoTargetLanguage: state.translation.echo_target_language,
								}),
					},
				}
			: {}),
	};
}

/* ------------------------------------------------------------------ rendering */

export function responseId(): string {
	return `resp_${randomBytes(12).toString("base64url")}`;
}

export function renderConversationSession(
	state: RealtimeConversationState,
): Record<string, unknown> {
	return {
		object: "realtime.session",
		type: "realtime",
		id: state.id,
		model: state.model,
		output_modalities: [state.outputModality],
		instructions: state.instructions,
		audio: {
			input: {
				format: state.inputFormat,
				transcription: state.transcription,
				noise_reduction: state.noiseReduction,
				turn_detection: state.turnDetection,
			},
			output: {
				format: state.outputFormat,
				...(state.voice === null ? {} : { voice: state.voice }),
				speed: state.speed,
			},
		},
		tools: state.tools,
		tool_choice: state.toolChoice,
		max_output_tokens: state.maxOutputTokens,
		...(state.reasoningEffort
			? { reasoning: { effort: state.reasoningEffort } }
			: {}),
		truncation: state.truncation,
		tracing: state.tracing ?? null,
		prompt: state.prompt ?? null,
		include: state.include.length > 0 ? state.include : null,
		...(state.translation ? { translation: state.translation } : {}),
		expires_at: 0,
	};
}

/** Realtime usage as OpenAI's `response.done` usage. */
export function renderResponseUsage(
	usage: RealtimeUsage | null,
): Record<string, unknown> | null {
	if (!usage) {
		return null;
	}
	return {
		total_tokens: usage.totalTokens,
		input_tokens: usage.inputTokens,
		output_tokens: usage.outputTokens,
		input_token_details: {
			cached_tokens: usage.cachedTokens ?? 0,
			text_tokens: usage.textTokens ?? 0,
			audio_tokens: usage.audioTokens ?? 0,
			image_tokens: usage.imageTokens ?? 0,
		},
		output_token_details: {
			text_tokens: usage.outputTextTokens ?? 0,
			audio_tokens: usage.outputAudioTokens ?? 0,
		},
	};
}

export function conversationEvent(
	type: string,
	fields: Record<string, unknown>,
): Record<string, unknown> {
	return { type, event_id: eventId(), ...fields };
}
