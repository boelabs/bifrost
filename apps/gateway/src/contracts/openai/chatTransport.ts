/**
 * OpenAI as an UPSTREAM (not as an input contract). The OpenAI adapter uses this to build the
 * /chat/completions body from the canonical request and to parse OpenAI responses/chunks back into
 * canonical types.
 *
 * (chat.ts is the edge with the CLIENT; chatTransport.ts is the edge with the OpenAI PROVIDER.)
 */

import { mergeExtraBody } from "#core/extraBody.ts";
import { GatewayError } from "#core/errors.ts";
import type { Usage } from "#core/usage.ts";

import type {
	CanonicalChatStreamChunk,
	CanonicalResponseFormat,
	CanonicalChatResponse,
	CanonicalFinishReason,
	CanonicalChatRequest,
	CanonicalContentPart,
	CanonicalMessage,
} from "#core/canonical.ts";

import {
	resolveBodyFieldReasoning,
	toUpstreamReasoningEffort,
	resolveChatTemplateFlag,
	type ReasoningSpec,
	resolveReasoning,
} from "#core/reasoning.ts";

const OPENAI_CHAT_TRANSPORT_MANAGED_KEYS = [
	"model",
	"messages",
	"stream",
	"stream_options",
	"max_completion_tokens",
	"max_tokens",
	"temperature",
	"top_p",
	"n",
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
	"parallel_tool_calls",
	"tools",
	"tool_choice",
	"response_format",
	"reasoning_effort",
	"prompt_cache_key",
] as const;

/* ----------------------------------------------------- canonical -> OpenAI transport */

function toTransportPart(p: CanonicalContentPart): Record<string, unknown> {
	switch (p.type) {
		case "text":
			return { type: "text", text: p.text };
		case "image":
			return {
				type: "image_url",
				image_url: {
					url: p.url,
					...(p.detail !== undefined ? { detail: p.detail } : {}),
				},
			};
		case "audio":
			return {
				type: "input_audio",
				input_audio: { data: p.data, format: p.format },
			};
		case "file":
			return {
				type: "file",
				file: {
					...(p.fileId !== undefined ? { file_id: p.fileId } : {}),
					...(p.fileData !== undefined ? { file_data: p.fileData } : {}),
					...(p.filename !== undefined ? { filename: p.filename } : {}),
				},
			};
	}
}

function toTransportMessage(m: CanonicalMessage): Record<string, unknown> {
	const out: Record<string, unknown> = {
		role: m.role,
		content:
			m.content === null
				? null
				: typeof m.content === "string"
					? m.content
					: m.content.map(toTransportPart),
	};
	if (m.name !== undefined) out.name = m.name;
	if (m.toolCalls) {
		out.tool_calls = m.toolCalls.map((tc) => ({
			id: tc.id,
			type: "function",
			function: { name: tc.name, arguments: tc.arguments },
		}));
	}
	if (m.toolCallId !== undefined) out.tool_call_id = m.toolCallId;
	return out;
}

function toTransportResponseFormat(
	rf: CanonicalResponseFormat,
): Record<string, unknown> {
	if (rf.type === "json_schema") {
		return {
			type: "json_schema",
			json_schema: {
				name: rf.name ?? "structured_output",
				schema: rf.schema,
				...(rf.description !== undefined
					? { description: rf.description }
					: {}),
				...(rf.strict !== undefined ? { strict: rf.strict } : {}),
			},
		};
	}
	return { type: rf.type };
}

export interface BuildChatBodyOptions {
	/**
	 * Field for the output token limit. Modern OpenAI uses `max_completion_tokens`;
	 * many compatibles only accept `max_tokens`.
	 */
	maxTokensField?: "max_completion_tokens" | "max_tokens";
	reasoningSpec?: ReasoningSpec;
}

function openAIReasoningEffort(
	req: CanonicalChatRequest,
	spec: ReasoningSpec | undefined,
): string | undefined {
	const effort = req.reasoning?.effort;
	if (!spec) {
		if (effort === undefined || effort === "none") return undefined;
		throw new GatewayError({
			class: "bad_request",
			message:
				"The selected model does not support OpenAI-style reasoning controls",
			code: "unsupported_model_capability",
			param: "reasoning",
		});
	}
	// A fixed reasoner has no knob to send. Capability validation guarantees the client can only
	// declare its single normalized state (`high`).
	if (spec.kind === "fixed") return undefined;
	if (spec.kind !== "openai_effort") {
		throw new GatewayError({
			class: "bad_request",
			message: `Reasoning control "${spec.kind}" cannot be emitted as OpenAI reasoning_effort`,
			code: "unsupported_model_capability",
			param: "reasoning",
		});
	}
	// Omitting effort -> lowest supported level (not the upstream's opaque default).
	return toUpstreamReasoningEffort(
		resolveReasoning(req.reasoning, spec).effort,
		spec,
	);
}

export function buildOpenAIChatBody(
	req: CanonicalChatRequest,
	upstreamModel: string,
	opts: BuildChatBodyOptions = {},
): Record<string, unknown> {
	const maxTokensField = opts.maxTokensField ?? "max_completion_tokens";
	const body: Record<string, unknown> = {
		model: upstreamModel,
		messages: req.messages.map(toTransportMessage),
		stream: req.stream,
	};
	// We ALWAYS request usage in streaming so we can account for it (TPM/budget/cost). If the client
	// did not request include_usage, the endpoint strips usage from the chunks it forwards (fidelity).
	if (req.stream)
		body.stream_options = {
			...(req.chatTransport?.streamOptions ?? {}),
			include_usage: true,
		};
	if (req.maxTokens !== undefined) body[maxTokensField] = req.maxTokens;
	if (req.temperature !== undefined) body.temperature = req.temperature;
	if (req.topP !== undefined) body.top_p = req.topP;
	if (req.n !== undefined) body.n = req.n;
	if (req.stop !== undefined) body.stop = req.stop;
	if (req.presencePenalty !== undefined)
		body.presence_penalty = req.presencePenalty;
	if (req.frequencyPenalty !== undefined)
		body.frequency_penalty = req.frequencyPenalty;
	if (req.seed !== undefined) body.seed = req.seed;
	if (req.user !== undefined) body.user = req.user;
	const chatOptions = req.chatTransport;
	if (chatOptions?.audio !== undefined) body.audio = chatOptions.audio;
	if (chatOptions?.logprobs !== undefined) body.logprobs = chatOptions.logprobs;
	if (chatOptions?.topLogprobs !== undefined)
		body.top_logprobs = chatOptions.topLogprobs;
	if (chatOptions?.logitBias !== undefined)
		body.logit_bias = chatOptions.logitBias;
	if (chatOptions?.metadata !== undefined) body.metadata = chatOptions.metadata;
	if (chatOptions?.modalities !== undefined)
		body.modalities = chatOptions.modalities;
	if (chatOptions?.prediction !== undefined)
		body.prediction = chatOptions.prediction;
	if (chatOptions?.serviceTier !== undefined)
		body.service_tier = chatOptions.serviceTier;
	if (chatOptions?.safetyIdentifier !== undefined)
		body.safety_identifier = chatOptions.safetyIdentifier;
	if (chatOptions?.store !== undefined) body.store = chatOptions.store;
	if (chatOptions?.verbosity !== undefined)
		body.verbosity = chatOptions.verbosity;
	if (chatOptions?.webSearchOptions !== undefined)
		body.web_search_options = chatOptions.webSearchOptions;
	if (req.parallelToolCalls !== undefined)
		body.parallel_tool_calls = req.parallelToolCalls;
	if (req.tools) {
		body.tools = req.tools.map((t) => ({
			type: "function",
			function: {
				name: t.name,
				...(t.description !== undefined ? { description: t.description } : {}),
				...(t.parameters !== undefined ? { parameters: t.parameters } : {}),
				...(t.strict !== undefined ? { strict: t.strict } : {}),
			},
		}));
	}
	if (req.toolChoice !== undefined) {
		if (typeof req.toolChoice === "string") body.tool_choice = req.toolChoice;
		else if ("name" in req.toolChoice)
			body.tool_choice = {
				type: "function",
				function: { name: req.toolChoice.name },
			};
		else
			body.tool_choice = {
				type: "allowed_tools",
				allowed_tools: {
					mode: req.toolChoice.mode,
					tools: req.toolChoice.allowedTools.map((name) => ({
						type: "function",
						function: { name },
					})),
				},
			};
	}
	if (req.responseFormat)
		body.response_format = toTransportResponseFormat(req.responseFormat);
	if (req.promptCacheKey !== undefined)
		body.prompt_cache_key = req.promptCacheKey;
	const spec = opts.reasoningSpec;
	// Non-scalar controls are injected AFTER merging extra_body, to preserve the client's other keys
	// but win over the catalog-managed toggle.
	if (spec?.kind !== "chat_template_flag" && spec?.kind !== "openai_body") {
		const effort = openAIReasoningEffort(req, spec);
		if (effort !== undefined) body.reasoning_effort = effort;
	}
	const merged = mergeExtraBody(
		body,
		req.extraBody,
		OPENAI_CHAT_TRANSPORT_MANAGED_KEYS,
	);
	if (spec?.kind === "openai_body") {
		const field = resolveBodyFieldReasoning(req.reasoning, spec);
		if (field) merged[field.param] = field.value;
		if (spec.effortField) {
			const effort = resolveReasoning(req.reasoning, spec).effort;
			if (effort !== "none")
				merged[spec.effortField] = toUpstreamReasoningEffort(effort, spec);
		}
	}
	if (spec?.kind === "chat_template_flag") {
		const flag = resolveChatTemplateFlag(req.reasoning, spec);
		if (flag) {
			const existing = merged.chat_template_kwargs;
			const base =
				existing !== null &&
				typeof existing === "object" &&
				!Array.isArray(existing)
					? (existing as Record<string, unknown>)
					: {};
			merged.chat_template_kwargs = { ...base, [flag.param]: flag.value };
		}
	}
	return merged;
}

/* ----------------------------------------------------- OpenAI transport -> canonical */

function mapFinishReason(f: unknown): CanonicalFinishReason | null {
	if (f == null) return null;
	if (f === "function_call") return "tool_calls";
	if (
		f === "stop" ||
		f === "length" ||
		f === "tool_calls" ||
		f === "content_filter"
	)
		return f;
	const reason = String(f).toLowerCase();
	if (/max.?tokens?|context.?window|length/.test(reason)) return "length";
	if (/tool.?use|function.?call/.test(reason)) return "tool_calls";
	if (
		/content.?filter|safety|guardrail|block|prohibit|refus|recitation|language|spii/.test(
			reason,
		)
	)
		return "content_filter";
	return "stop";
}

interface TransportUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number };
	completion_tokens_details?: { reasoning_tokens?: number };
}

function mapUsage(u: TransportUsage | undefined | null): Usage {
	const promptTokens = u?.prompt_tokens ?? 0;
	const completionTokens = u?.completion_tokens ?? 0;
	const usage: Usage = {
		promptTokens,
		completionTokens,
		totalTokens: u?.total_tokens ?? promptTokens + completionTokens,
	};
	if (u?.prompt_tokens_details?.cached_tokens !== undefined) {
		usage.cacheReadTokens = u.prompt_tokens_details.cached_tokens;
	}
	if (u?.completion_tokens_details?.reasoning_tokens !== undefined) {
		usage.reasoningTokens = u.completion_tokens_details.reasoning_tokens;
	}
	return usage;
}

interface TransportToolCall {
	id?: string;
	index?: number;
	function?: { name?: string; arguments?: string };
	extra_content?: Record<string, unknown>;
}

interface TransportResponse {
	id?: string;
	created?: number;
	model?: string;
	choices?: Array<{
		index?: number;
		finish_reason?: unknown;
		logprobs?: unknown;
		message?: {
			content?: string | null;
			reasoning?: string | null;
			reasoning_content?: string | null;
			refusal?: string | null;
			audio?: Record<string, unknown> | null;
			annotations?: Record<string, unknown>[];
			tool_calls?: TransportToolCall[];
		};
	}>;
	usage?: TransportUsage;
}

export function parseOpenAIChatResponse(raw: unknown): CanonicalChatResponse {
	const r = (raw ?? {}) as TransportResponse;
	return {
		id: r.id ?? "",
		created: r.created ?? Math.floor(Date.now() / 1000),
		model: r.model ?? "",
		choices: (r.choices ?? []).map((c, i) => {
			const message: CanonicalChatResponse["choices"][number]["message"] = {
				role: "assistant",
				content: c.message?.content ?? null,
			};
			const reasoning = c.message?.reasoning ?? c.message?.reasoning_content;
			if (reasoning !== undefined) message.reasoning = reasoning;
			if (c.message?.refusal != null) message.refusal = c.message.refusal;
			if (c.message?.audio !== undefined) message.audio = c.message.audio;
			if (c.message?.annotations !== undefined)
				message.annotations = c.message.annotations;
			if (c.message?.tool_calls) {
				message.toolCalls = c.message.tool_calls.map((tc) => ({
					id: tc.id ?? "",
					name: tc.function?.name ?? "",
					arguments: tc.function?.arguments ?? "",
					...(tc.extra_content !== undefined
						? { extraContent: tc.extra_content }
						: {}),
				}));
			}
			return {
				index: c.index ?? i,
				finishReason: mapFinishReason(c.finish_reason),
				...(c.logprobs !== undefined ? { logprobs: c.logprobs } : {}),
				message,
			};
		}),
		usage: mapUsage(r.usage),
	};
}

interface TransportChunk {
	id?: string;
	created?: number;
	model?: string;
	choices?: Array<{
		index?: number;
		finish_reason?: unknown;
		logprobs?: unknown;
		delta?: {
			role?: string;
			content?: string;
			reasoning?: string;
			reasoning_content?: string;
			refusal?: string;
			audio?: Record<string, unknown>;
			annotations?: Record<string, unknown>[];
			tool_calls?: TransportToolCall[];
		};
	}>;
	usage?: TransportUsage | null;
}

export function parseOpenAIChatChunk(raw: unknown): CanonicalChatStreamChunk {
	const r = (raw ?? {}) as TransportChunk;
	const chunk: CanonicalChatStreamChunk = {
		id: r.id ?? "",
		created: r.created ?? Math.floor(Date.now() / 1000),
		model: r.model ?? "",
		choices: (r.choices ?? []).map((c, i) => {
			const delta: CanonicalChatStreamChunk["choices"][number]["delta"] = {};
			if (c.delta?.role === "assistant") delta.role = "assistant";
			if (c.delta?.content !== undefined) delta.content = c.delta.content;
			if (c.delta?.reasoning !== undefined) delta.reasoning = c.delta.reasoning;
			else if (c.delta?.reasoning_content !== undefined)
				delta.reasoning = c.delta.reasoning_content;
			if (c.delta?.refusal !== undefined) delta.refusal = c.delta.refusal;
			if (c.delta?.audio !== undefined) delta.audio = c.delta.audio;
			if (c.delta?.annotations !== undefined)
				delta.annotations = c.delta.annotations;
			if (c.delta?.tool_calls) {
				delta.toolCalls = c.delta.tool_calls.map((tc, j) => ({
					index: tc.index ?? j,
					...(tc.id !== undefined ? { id: tc.id } : {}),
					...(tc.function?.name !== undefined
						? { name: tc.function.name }
						: {}),
					...(tc.function?.arguments !== undefined
						? { arguments: tc.function.arguments }
						: {}),
					...(tc.extra_content !== undefined
						? { extraContent: tc.extra_content }
						: {}),
				}));
			}
			return {
				index: c.index ?? i,
				delta,
				finishReason: mapFinishReason(c.finish_reason),
				...(c.logprobs !== undefined ? { logprobs: c.logprobs } : {}),
			};
		}),
	};
	if (r.usage !== undefined) chunk.usage = r.usage ? mapUsage(r.usage) : null;
	return chunk;
}
