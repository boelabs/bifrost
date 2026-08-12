import { fileParserOptionsFromPlugins } from "#contracts/fileParser.ts";
import { EFFORT_ORDER, summaryForEffort } from "#core/reasoning.ts";
import { assertNoManagedExtraBodyKeys } from "#core/extraBody.ts";
import { GatewayError } from "#core/errors.ts";
import type { Usage } from "#core/usage.ts";
import * as z from "zod/v4";

import {
	providerSpecificFieldsFromExtraContent,
	extraContentFromProviderSpecificFields,
	withoutOpenAIResponsesStreamMetadata,
	providerSpecificFieldsFromToolCalls,
	openaiReasoningFromProviderFields,
	mergeProviderExtraContent,
	decodeThoughtSignatureId,
	encodeThoughtSignatureId,
	stripThoughtSignatureId,
	mergeProviderFields,
} from "#core/providerSpecificFields.ts";

import type {
	CanonicalChatStreamChunk,
	CanonicalResponseFormat,
	CanonicalChatResponse,
	CanonicalChatRequest,
	CanonicalContentPart,
	CanonicalToolChoice,
	CanonicalMessage,
} from "#core/canonical.ts";

const reasoningEffortSchema = z.enum(EFFORT_ORDER);
const reasoningSummarySchema = z.enum(["auto", "none", "concise", "detailed"]);
const reasoningSchema = z
	.object({
		effort: reasoningEffortSchema.optional(),
		summary: reasoningSummarySchema.optional(),
	})
	.loose();

/* ============================================================ REQUEST ===
 * Schema of the OpenAI /v1/chat/completions contract. We validate the standard fields
 * and use loose objects to tolerate new extensions without breaking clients.
 */

const CHAT_EXTRA_BODY_MANAGED_KEYS = [
	"model",
	"messages",
	"stream",
	"stream_options",
	"temperature",
	"top_p",
	"n",
	"max_tokens",
	"max_completion_tokens",
	"stop",
	"presence_penalty",
	"frequency_penalty",
	"seed",
	"user",
	"audio",
	"logprobs",
	"top_logprobs",
	"logit_bias",
	"metadata",
	"modalities",
	"prediction",
	"service_tier",
	"safety_identifier",
	"store",
	"verbosity",
	"web_search_options",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"response_format",
	"reasoning",
	"reasoning_effort",
	"prompt_cache_key",
	"plugins",
	"extra_body",
] as const;

const textPart = z
	.object({ type: z.literal("text"), text: z.string() })
	.loose();
const imagePart = z
	.object({
		type: z.literal("image_url"),
		image_url: z
			.object({
				url: z.string(),
				detail: z.enum(["auto", "low", "high"]).optional(),
			})
			.loose(),
	})
	.loose();
const audioPart = z
	.object({
		type: z.literal("input_audio"),
		input_audio: z
			.object({ data: z.string(), format: z.enum(["wav", "mp3"]) })
			.loose(),
	})
	.loose();
const refusalPart = z
	.object({ type: z.literal("refusal"), refusal: z.string() })
	.loose();
const filePart = z
	.object({
		type: z.literal("file"),
		file: z
			.object({
				file_id: z.string().optional(),
				file_data: z.string().optional(),
				filename: z.string().optional(),
			})
			.loose(),
	})
	.loose();

const contentPart = z.union([
	textPart,
	imagePart,
	audioPart,
	refusalPart,
	filePart,
]);
const messageContent = z.union([z.string(), z.array(contentPart)]);

const toolCallSchema = z
	.object({
		id: z.string(),
		type: z.literal("function"),
		function: z.object({ name: z.string(), arguments: z.string() }).loose(),
	})
	.loose();

const messageSchema = z
	.object({
		role: z.enum(["system", "developer", "user", "assistant", "tool"]),
		content: messageContent.nullable().optional(),
		name: z.string().optional(),
		tool_calls: z.array(toolCallSchema).optional(),
		tool_call_id: z.string().optional(),
		refusal: z.string().nullable().optional(),
	})
	.loose();

const toolSchema = z
	.object({
		type: z.literal("function"),
		function: z
			.object({
				name: z.string(),
				description: z.string().optional(),
				parameters: z.record(z.string(), z.unknown()).optional(),
				strict: z.boolean().nullish(),
			})
			.loose(),
	})
	.loose();

const toolChoiceSchema = z.union([
	z.enum(["none", "auto", "required"]),
	z
		.object({
			type: z.literal("function"),
			function: z.object({ name: z.string() }).loose(),
		})
		.loose(),
	z
		.object({
			type: z.literal("allowed_tools"),
			allowed_tools: z.object({
				mode: z.enum(["auto", "required"]),
				tools: z.array(
					z.object({
						type: z.literal("function"),
						function: z.object({ name: z.string() }).loose(),
					}),
				),
			}),
		})
		.loose(),
]);

const responseFormatSchema = z.union([
	z.object({ type: z.literal("text") }).loose(),
	z.object({ type: z.literal("json_object") }).loose(),
	z
		.object({
			type: z.literal("json_schema"),
			json_schema: z
				.object({
					name: z.string(),
					schema: z.record(z.string(), z.unknown()).optional(),
					strict: z.boolean().nullish(),
					description: z.string().optional(),
				})
				.loose(),
		})
		.loose(),
]);

export const chatRequestSchema = z
	.object({
		model: z.string(),
		messages: z.array(messageSchema).min(1),
		stream: z.boolean().optional().default(false),
		stream_options: z
			.object({
				include_usage: z.boolean().optional(),
				include_obfuscation: z.boolean().optional(),
			})
			.loose()
			.optional(),
		temperature: z.number().optional(),
		top_p: z.number().optional(),
		n: z.int().optional(),
		max_tokens: z.int().optional(),
		max_completion_tokens: z.int().optional(),
		stop: z.union([z.string(), z.array(z.string())]).nullish(),
		presence_penalty: z.number().optional(),
		frequency_penalty: z.number().optional(),
		seed: z.int().optional(),
		user: z.string().optional(),
		audio: z.record(z.string(), z.unknown()).optional(),
		logprobs: z.boolean().optional(),
		top_logprobs: z.int().min(0).max(20).optional(),
		logit_bias: z.record(z.string(), z.number()).optional(),
		metadata: z.record(z.string(), z.string()).optional(),
		modalities: z.array(z.string()).optional(),
		prediction: z.record(z.string(), z.unknown()).optional(),
		service_tier: z.string().optional(),
		safety_identifier: z.string().max(64).optional(),
		store: z.boolean().optional(),
		verbosity: z.string().optional(),
		web_search_options: z.record(z.string(), z.unknown()).optional(),
		tools: z.array(toolSchema).optional(),
		tool_choice: toolChoiceSchema.optional(),
		parallel_tool_calls: z.boolean().optional(),
		response_format: responseFormatSchema.optional(),
		reasoning_effort: reasoningEffortSchema.optional(),
		reasoning: reasoningSchema.optional(),
		prompt_cache_key: z.string().optional(),
		plugins: z.array(z.record(z.string(), z.unknown())).optional(),
		extra_body: z.record(z.string(), z.unknown()).optional(),
	})
	.loose();

export type OpenAIChatRequest = z.infer<typeof chatRequestSchema>;

/* =========================================================== RESPONSE ===
 * Schemas of what the gateway EMITS (output validation in tests).
 */

const usageSchema = z
	.object({
		prompt_tokens: z.number(),
		completion_tokens: z.number(),
		total_tokens: z.number(),
		prompt_tokens_details: z
			.object({ cached_tokens: z.number().optional() })
			.optional(),
		completion_tokens_details: z
			.object({ reasoning_tokens: z.number().optional() })
			.optional(),
	})
	.loose();

export const chatResponseSchema = z
	.object({
		id: z.string(),
		object: z.literal("chat.completion"),
		created: z.number(),
		model: z.string(),
		choices: z.array(
			z.object({
				index: z.number(),
				finish_reason: z
					.enum(["stop", "length", "tool_calls", "content_filter"])
					.nullable(),
				message: z
					.object({
						role: z.literal("assistant"),
						content: z.string().nullable(),
						refusal: z.string().nullable().optional(),
						audio: z.record(z.string(), z.unknown()).nullable().optional(),
						annotations: z.array(z.record(z.string(), z.unknown())).optional(),
						tool_calls: z
							.array(
								z.object({
									id: z.string(),
									type: z.literal("function"),
									function: z.object({
										name: z.string(),
										arguments: z.string(),
									}),
								}),
							)
							.optional(),
					})
					.loose(),
				logprobs: z.unknown().nullable(),
			}),
		),
		usage: usageSchema,
	})
	.loose();

export const chatChunkSchema = z
	.object({
		id: z.string(),
		object: z.literal("chat.completion.chunk"),
		created: z.number(),
		model: z.string(),
		choices: z.array(
			z.object({
				index: z.number(),
				delta: z
					.object({
						role: z.literal("assistant").optional(),
						content: z.string().optional(),
						refusal: z.string().nullable().optional(),
						tool_calls: z
							.array(z.object({ index: z.number() }).loose())
							.optional(),
					})
					.loose(),
				finish_reason: z
					.enum(["stop", "length", "tool_calls", "content_filter"])
					.nullable(),
				logprobs: z.unknown().nullable().optional(),
			}),
		),
		usage: usageSchema.nullish(),
	})
	.loose();

export type OpenAIChatResponse = z.infer<typeof chatResponseSchema>;
export type OpenAIChatChunk = z.infer<typeof chatChunkSchema>;

/* ========================================================= TRANSLATORS ===
 * OpenAI (edge) ⟷ canonical types (core).
 */

function extraContent(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return value as Record<string, unknown>;
}

function mapContent(
	content: z.infer<typeof messageContent> | null | undefined,
): string | CanonicalContentPart[] | null {
	if (content === null || content === undefined) return null;
	if (typeof content === "string") return content;
	return content.map((part): CanonicalContentPart => {
		switch (part.type) {
			case "text":
				return { type: "text", text: part.text };
			case "refusal":
				return { type: "text", text: part.refusal };
			case "image_url":
				return part.image_url.detail !== undefined
					? {
							type: "image",
							url: part.image_url.url,
							detail: part.image_url.detail,
						}
					: { type: "image", url: part.image_url.url };
			case "input_audio":
				return {
					type: "audio",
					data: part.input_audio.data,
					format: part.input_audio.format,
				};
			case "file": {
				const f: CanonicalContentPart = { type: "file" };
				if (part.file.file_id !== undefined) f.fileId = part.file.file_id;
				if (part.file.file_data !== undefined) {
					if (/^https:\/\//i.test(part.file.file_data))
						f.fileUrl = part.file.file_data;
					else f.fileData = part.file.file_data;
				}
				if (part.file.filename !== undefined) f.filename = part.file.filename;
				return f;
			}
			default:
				throw new GatewayError({
					class: "bad_request",
					message: `Unsupported content type: "${(part as { type: string }).type}"`,
					param: "messages",
				});
		}
	});
}

function mapMessage(m: z.infer<typeof messageSchema>): CanonicalMessage {
	const msg: CanonicalMessage = {
		role: m.role,
		content: mapContent(m.content),
	};
	if (m.name !== undefined) msg.name = m.name;
	if (m.tool_calls !== undefined) {
		msg.toolCalls = m.tool_calls.map((tc) => {
			const raw = tc as unknown as Record<string, unknown>;
			const decoded = decodeThoughtSignatureId(tc.id);
			const extra = mergeProviderExtraContent(
				decoded.extraContent,
				extraContentFromProviderSpecificFields(raw.provider_specific_fields),
				extraContent(raw.extra_content),
			);
			return {
				id: decoded.id,
				name: tc.function.name,
				arguments: tc.function.arguments,
				...(extra !== undefined ? { extraContent: extra } : {}),
			};
		});
	}
	if (m.tool_call_id !== undefined)
		msg.toolCallId = stripThoughtSignatureId(m.tool_call_id);
	if (m.role === "assistant") {
		const raw = m as unknown as Record<string, unknown>;
		const providerFields = extraContent(raw.provider_specific_fields);
		const reasoning = openaiReasoningFromProviderFields(providerFields);
		const mergedProviderFields = mergeProviderFields(
			providerFields,
			reasoning !== undefined ? { openai: { reasoning } } : undefined,
		);
		if (mergedProviderFields !== undefined)
			msg.providerFields = mergedProviderFields;
	}
	return msg;
}

function mapToolChoice(
	tc: z.infer<typeof toolChoiceSchema>,
): CanonicalToolChoice {
	if (typeof tc === "string") return tc;
	if (tc.type === "function") return { name: tc.function.name };
	return {
		allowedTools: tc.allowed_tools.tools.map((tool) => tool.function.name),
		mode: tc.allowed_tools.mode,
	};
}

function mapResponseFormat(
	rf: z.infer<typeof responseFormatSchema>,
): CanonicalResponseFormat {
	if (rf.type === "json_schema") {
		const out: CanonicalResponseFormat = {
			type: "json_schema",
			name: rf.json_schema.name,
			schema: rf.json_schema.schema ?? {},
		};
		if (rf.json_schema.description !== undefined)
			out.description = rf.json_schema.description;
		if (rf.json_schema.strict != null) out.strict = rf.json_schema.strict;
		return out;
	}
	return { type: rf.type };
}

/** Validated OpenAI request -> normalized canonical request. */
export function toCanonicalChatRequest(
	req: OpenAIChatRequest,
): CanonicalChatRequest {
	const u: CanonicalChatRequest = {
		callType: "chat",
		publicWire: "chat_completions",
		model: req.model,
		messages: req.messages.map(mapMessage),
		stream: req.stream,
	};
	const fileParser = fileParserOptionsFromPlugins(req.plugins);
	if (fileParser !== undefined) u.fileParser = fileParser;
	const maxTokens = req.max_completion_tokens ?? req.max_tokens;
	if (maxTokens !== undefined) u.maxTokens = maxTokens;
	if (req.stream_options?.include_usage !== undefined)
		u.includeUsage = req.stream_options.include_usage;
	if (req.temperature !== undefined) u.temperature = req.temperature;
	if (req.top_p !== undefined) u.topP = req.top_p;
	if (req.n !== undefined) u.n = req.n;
	if (req.stop != null)
		u.stop = typeof req.stop === "string" ? [req.stop] : req.stop;
	if (req.presence_penalty !== undefined)
		u.presencePenalty = req.presence_penalty;
	if (req.frequency_penalty !== undefined)
		u.frequencyPenalty = req.frequency_penalty;
	if (req.seed !== undefined) u.seed = req.seed;
	if (req.user !== undefined) u.user = req.user;
	const chatTransport = {
		...(req.audio !== undefined ? { audio: req.audio } : {}),
		...(req.logprobs !== undefined ? { logprobs: req.logprobs } : {}),
		...(req.top_logprobs !== undefined
			? { topLogprobs: req.top_logprobs }
			: {}),
		...(req.logit_bias !== undefined ? { logitBias: req.logit_bias } : {}),
		...(req.metadata !== undefined ? { metadata: req.metadata } : {}),
		...(req.modalities !== undefined ? { modalities: req.modalities } : {}),
		...(req.prediction !== undefined ? { prediction: req.prediction } : {}),
		...(req.service_tier !== undefined
			? { serviceTier: req.service_tier }
			: {}),
		...(req.safety_identifier !== undefined
			? { safetyIdentifier: req.safety_identifier }
			: {}),
		...(req.store !== undefined ? { store: req.store } : {}),
		...(req.verbosity !== undefined ? { verbosity: req.verbosity } : {}),
		...(req.web_search_options !== undefined
			? { webSearchOptions: req.web_search_options }
			: {}),
		...(req.stream_options?.include_obfuscation !== undefined
			? {
					streamOptions: {
						include_obfuscation: req.stream_options.include_obfuscation,
					},
				}
			: {}),
	};
	if (Object.keys(chatTransport).length > 0) {
		u.chatTransport = chatTransport;
		u.requiresNativeWire = true;
	}
	if (req.parallel_tool_calls !== undefined)
		u.parallelToolCalls = req.parallel_tool_calls;
	const reasoningEffort = req.reasoning?.effort ?? req.reasoning_effort;
	if (
		req.reasoning?.effort !== undefined &&
		req.reasoning_effort !== undefined &&
		req.reasoning.effort !== req.reasoning_effort
	) {
		throw new GatewayError({
			class: "bad_request",
			message:
				"reasoning.effort and reasoning_effort must match when both are provided",
			param: "reasoning_effort",
		});
	}
	const reasoningSummary = summaryForEffort(
		reasoningEffort,
		req.reasoning?.summary,
	);
	if (reasoningEffort !== undefined || reasoningSummary !== undefined) {
		u.reasoning = {
			...(reasoningEffort !== undefined ? { effort: reasoningEffort } : {}),
			...(reasoningSummary !== undefined ? { summary: reasoningSummary } : {}),
		};
	}
	if (req.prompt_cache_key !== undefined)
		u.promptCacheKey = req.prompt_cache_key;
	if (req.extra_body !== undefined) {
		assertNoManagedExtraBodyKeys(req.extra_body, CHAT_EXTRA_BODY_MANAGED_KEYS);
		u.extraBody = req.extra_body;
	}
	if (req.tools !== undefined) {
		u.tools = req.tools.map((t) => {
			const tool: NonNullable<CanonicalChatRequest["tools"]>[number] = {
				name: t.function.name,
			};
			if (t.function.description !== undefined)
				tool.description = t.function.description;
			if (t.function.parameters !== undefined)
				tool.parameters = t.function.parameters;
			if (t.function.strict != null) tool.strict = t.function.strict;
			return tool;
		});
	}
	if (req.tool_choice !== undefined)
		u.toolChoice = mapToolChoice(req.tool_choice);
	if (req.response_format !== undefined)
		u.responseFormat = mapResponseFormat(req.response_format);
	return u;
}

function toOpenAIUsage(u: Usage): z.infer<typeof usageSchema> {
	const out: z.infer<typeof usageSchema> = {
		prompt_tokens: u.promptTokens,
		completion_tokens: u.completionTokens,
		total_tokens: u.totalTokens,
	};
	if (u.cacheReadTokens !== undefined)
		out.prompt_tokens_details = { cached_tokens: u.cacheReadTokens };
	if (u.reasoningTokens !== undefined) {
		out.completion_tokens_details = { reasoning_tokens: u.reasoningTokens };
	}
	return out;
}

function toolCallProviderSpecificFields(
	extraContent: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	return providerSpecificFieldsFromExtraContent(extraContent);
}

function renderResponseToolCall(tc: {
	id: string;
	name: string;
	arguments: string;
	extraContent?: Record<string, unknown>;
}): {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
	extra_content?: Record<string, unknown>;
	provider_specific_fields?: Record<string, unknown>;
} {
	const providerSpecificFields = providerSpecificFieldsFromExtraContent(
		tc.extraContent,
	);
	return {
		// Embed the thought signature in the public id (LiteLLM-compatible) so clients that echo
		// tool call ids verbatim round-trip it without understanding any extra field.
		id: encodeThoughtSignatureId(tc.id, tc.extraContent),
		type: "function" as const,
		function: { name: tc.name, arguments: tc.arguments },
		...(tc.extraContent !== undefined
			? { extra_content: tc.extraContent }
			: {}),
		...(providerSpecificFields !== undefined
			? { provider_specific_fields: providerSpecificFields }
			: {}),
	};
}

function renderChunkToolCall(tc: {
	index: number;
	id?: string | undefined;
	name?: string | undefined;
	arguments?: string | undefined;
	extraContent?: Record<string, unknown> | undefined;
}): {
	index: number;
	id?: string;
	type: "function";
	function: { name?: string; arguments?: string };
	extra_content?: Record<string, unknown>;
	provider_specific_fields?: Record<string, unknown>;
} {
	const providerSpecificFields = toolCallProviderSpecificFields(
		tc.extraContent,
	);
	// Google delivers id and extraContent in the same canonical delta, so the first emission of
	// the id already carries the signature suffix. An upstream that split them across chunks
	// would emit a clean id (accepted limitation; no known upstream does).
	return {
		index: tc.index,
		...(tc.id !== undefined
			? { id: encodeThoughtSignatureId(tc.id, tc.extraContent) }
			: {}),
		type: "function" as const,
		function: {
			...(tc.name !== undefined ? { name: tc.name } : {}),
			...(tc.arguments !== undefined ? { arguments: tc.arguments } : {}),
		},
		...(tc.extraContent !== undefined
			? { extra_content: tc.extraContent }
			: {}),
		...(providerSpecificFields !== undefined
			? { provider_specific_fields: providerSpecificFields }
			: {}),
	};
}

/** Canonical response -> OpenAI response (non-stream). */
export function toOpenAIChatResponse(
	resp: CanonicalChatResponse,
): OpenAIChatResponse {
	return {
		// OpenAI uses the `chatcmpl-` prefix; we preserve the upstream id inside for traceability.
		id: resp.id.startsWith("chatcmpl-") ? resp.id : `chatcmpl-${resp.id}`,
		object: "chat.completion",
		created: resp.created,
		model: resp.model,
		choices: resp.choices.map((c) => {
			const providerSpecificFields = withoutOpenAIResponsesStreamMetadata(
				mergeProviderFields(
					providerSpecificFieldsFromToolCalls(c.message.toolCalls),
					c.message.providerFields,
				),
			);
			return {
				index: c.index,
				finish_reason: c.finishReason,
				logprobs: c.logprobs ?? null,
				message: {
					role: "assistant" as const,
					content: c.message.content,
					// OpenAI always includes `refusal` (null when the model did not refuse).
					refusal: c.message.refusal ?? null,
					...(c.message.audio !== undefined ? { audio: c.message.audio } : {}),
					...(c.message.annotations !== undefined
						? { annotations: c.message.annotations }
						: {}),
					...(c.message.reasoning !== undefined
						? { reasoning: c.message.reasoning }
						: {}),
					...(c.message.toolCalls
						? {
								tool_calls: c.message.toolCalls.map((tc) =>
									renderResponseToolCall({
										id: tc.id,
										name: tc.name,
										arguments: tc.arguments,
										...(tc.extraContent !== undefined
											? { extraContent: tc.extraContent }
											: {}),
									}),
								),
							}
						: {}),
					...(providerSpecificFields !== undefined
						? { provider_specific_fields: providerSpecificFields }
						: {}),
				},
			};
		}),
		usage: toOpenAIUsage(resp.usage),
	};
}

/** Canonical chunk -> OpenAI chunk (SSE). */
export function toOpenAIChatChunk(
	chunk: CanonicalChatStreamChunk,
): OpenAIChatChunk {
	return {
		id: chunk.id.startsWith("chatcmpl-") ? chunk.id : `chatcmpl-${chunk.id}`,
		object: "chat.completion.chunk",
		created: chunk.created,
		model: chunk.model,
		choices: chunk.choices.map((c) => {
			const providerSpecificFields = withoutOpenAIResponsesStreamMetadata(
				c.delta.providerFields,
			);
			return {
				index: c.index,
				finish_reason: c.finishReason,
				...(c.logprobs !== undefined ? { logprobs: c.logprobs } : {}),
				delta: {
					...(c.delta.role !== undefined ? { role: c.delta.role } : {}),
					// OpenAI: the first delta (with role) carries content:"" and refusal:null.
					...(c.delta.content !== undefined
						? { content: c.delta.content }
						: c.delta.role !== undefined
							? { content: "" }
							: {}),
					...(c.delta.reasoning !== undefined
						? { reasoning: c.delta.reasoning }
						: {}),
					...(c.delta.refusal !== undefined
						? { refusal: c.delta.refusal }
						: c.delta.role !== undefined
							? { refusal: null }
							: {}),
					...(c.delta.audio !== undefined ? { audio: c.delta.audio } : {}),
					...(c.delta.annotations !== undefined
						? { annotations: c.delta.annotations }
						: {}),
					...(c.delta.toolCalls
						? {
								tool_calls: c.delta.toolCalls.map((tc) =>
									renderChunkToolCall({
										index: tc.index,
										id: tc.id,
										name: tc.name,
										arguments: tc.arguments,
										extraContent: tc.extraContent,
									}),
								),
							}
						: {}),
					...(providerSpecificFields !== undefined
						? { provider_specific_fields: providerSpecificFields }
						: {}),
				},
			};
		}),
		...(chunk.usage !== undefined
			? { usage: chunk.usage ? toOpenAIUsage(chunk.usage) : null }
			: {}),
	};
}
