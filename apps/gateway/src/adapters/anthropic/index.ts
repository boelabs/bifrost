import { summaryVisible, toUpstreamReasoningEffort } from "#core/reasoning.ts";
import { type BaseCreds, requireApiKeyCreds } from "#adapters/creds.ts";
import { mapUpstreamHttpError } from "#adapters/upstreamError.ts";
import { looksLikeContextWindowError } from "#core/httpError.ts";
import { resolveAdapterReasoning } from "#adapters/reasoning.ts";
import type { ReasoningControlKind } from "#core/reasoning.ts";
import { mergeExtraBody } from "#core/extraBody.ts";
import { GatewayError } from "#core/errors.ts";
import type { Usage } from "#core/usage.ts";
import { randomUUID } from "node:crypto";
import { parseSSE } from "#core/sse.ts";

import type {
	CanonicalChatStreamChunk,
	CanonicalChatResponse,
	CanonicalFinishReason,
	CanonicalChatRequest,
	CanonicalContentPart,
	CanonicalMessage,
} from "#core/canonical.ts";

import {
	providerFieldsWithAnthropicThinking,
	anthropicThinkingFromProviderFields,
	type AnthropicThinkingBlock,
	mergeProviderFields,
} from "#core/providerSpecificFields.ts";

import {
	recordUnknownAdapterEvent,
	adapterContextDiagnostics,
	attachAdapterDiagnostics,
} from "#adapters/diagnostics.ts";

import type {
	AdapterContext,
	ProviderModule,
	ChatHandler,
	Adapter,
} from "#adapters/types.ts";

interface AnthropicCreds extends BaseCreds {
	version?: string;
}

interface AnthropicUsage {
	input_tokens?: number;
	output_tokens?: number;
	cache_read_input_tokens?: number;
	cache_creation_input_tokens?: number;
}

interface AnthropicContentBlock {
	type?: string;
	text?: string;
	thinking?: string;
	signature?: string;
	data?: string;
	id?: string;
	name?: string;
	input?: unknown;
}

interface AnthropicMessage {
	id?: string;
	model?: string;
	content?: AnthropicContentBlock[];
	stop_reason?: string | null;
	usage?: AnthropicUsage;
}

interface AnthropicStreamEvent {
	type?: string;
	message?: AnthropicMessage;
	index?: number;
	content_block?: AnthropicContentBlock;
	delta?: {
		type?: string;
		text?: string;
		thinking?: string;
		signature?: string;
		partial_json?: string;
		stop_reason?: string | null;
	};
	usage?: AnthropicUsage;
	error?: { type?: string; message?: string };
}

const DEFAULT_BASE = "https://api.anthropic.com/v1";
const DEFAULT_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;
const FAST_MODE_BETA = "fast-mode-2026-02-01";
const FAST_MODE_ALIASES: ReadonlyMap<string, string> = new Map([
	["claude-opus-5-fast", "claude-opus-5"],
	["claude-opus-4-8-fast", "claude-opus-4-8"],
	["claude-opus-4-7-fast", "claude-opus-4-7"],
]);
const ANTHROPIC_BODY_MANAGED_KEYS = [
	"model",
	"max_tokens",
	"stream",
	"system",
	"messages",
	"temperature",
	"top_p",
	"stop_sequences",
	"tools",
	"tool_choice",
	"thinking",
	"output_config",
	"speed",
] as const;
const DEFAULT_ANTHROPIC_BUDGETS = {
	minimal: 1_024,
	low: 2_048,
	medium: 8_192,
	high: 16_000,
	xhigh: 32_000,
} as const;

function creds(ctx: AdapterContext): AnthropicCreds & { apiKey: string } {
	return requireApiKeyCreds<AnthropicCreds>(
		ctx.credentials,
		"Anthropic adapter",
	);
}

function withPartCacheControl(
	part: CanonicalContentPart,
	block: Record<string, unknown>,
): Record<string, unknown> {
	return part.cacheControl !== undefined
		? { ...block, cache_control: part.cacheControl }
		: block;
}

function dataUrlSource(value: string): Record<string, unknown> | null {
	const match = /^data:([^;,]+);base64,(.*)$/s.exec(value);
	if (!match) return null;
	return { type: "base64", media_type: match[1], data: match[2] };
}

function textPartToAnthropic(
	part: CanonicalContentPart,
): Record<string, unknown> {
	if (part.type === "text") {
		return withPartCacheControl(part, {
			type: "text",
			text: part.text,
		});
	}
	throw new GatewayError({
		class: "bad_request",
		message: `Anthropic adapter: content part "${part.type}" is not supported in this phase`,
		param: "messages",
	});
}

function partToAnthropic(part: CanonicalContentPart): Record<string, unknown> {
	if (part.type === "text") return textPartToAnthropic(part);
	if (part.type === "image") {
		const source =
			dataUrlSource(part.url) ??
			(/^https:\/\//i.test(part.url) ? { type: "url", url: part.url } : null);
		if (source !== null)
			return withPartCacheControl(part, { type: "image", source });
	}
	if (part.type === "file") {
		let source: Record<string, unknown> | null = null;
		if (part.fileData !== undefined) source = dataUrlSource(part.fileData);
		else if (part.fileUrl !== undefined)
			source = { type: "url", url: part.fileUrl };
		else if (part.fileId !== undefined)
			source = { type: "file", file_id: part.fileId };
		if (source !== null) {
			return withPartCacheControl(part, {
				type: "document",
				source,
				...(part.filename !== undefined ? { title: part.filename } : {}),
			});
		}
	}
	throw new GatewayError({
		class: "bad_request",
		message: `Anthropic adapter: content part "${part.type}" is not supported`,
		param: "messages",
	});
}

function contentToAnthropic(
	content: CanonicalMessage["content"],
): string | Record<string, unknown>[] {
	if (content === null) return "";
	if (typeof content === "string") return content;
	return content.map(partToAnthropic);
}

function requestUsesProviderFileId(req: CanonicalChatRequest): boolean {
	return req.messages.some(
		(message) =>
			Array.isArray(message.content) &&
			message.content.some(
				(part) => part.type === "file" && part.fileId !== undefined,
			),
	);
}

function parseToolArguments(args: string): Record<string, unknown> {
	if (!args) return {};
	try {
		const parsed = JSON.parse(args) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

function buildMessages(req: CanonicalChatRequest): {
	system?: string | Record<string, unknown>[];
	messages: Array<{ role: "user" | "assistant"; content: unknown }>;
} {
	// We accumulate the system as text blocks. If any carries cache_control we emit it as an array
	// (to place the prompt-caching breakpoint); otherwise we flatten it to a string (back-compat).
	const systemBlocks: Record<string, unknown>[] = [];
	let systemHasCacheControl = false;
	const messages: Array<{ role: "user" | "assistant"; content: unknown }> = [];

	for (const message of req.messages) {
		if (message.role === "system" || message.role === "developer") {
			const content = message.content;
			if (typeof content === "string") {
				if (content.length > 0)
					systemBlocks.push({ type: "text", text: content });
			} else if (Array.isArray(content)) {
				for (const part of content) {
					const block = textPartToAnthropic(part);
					if (block.cache_control !== undefined) systemHasCacheControl = true;
					systemBlocks.push(block);
				}
			}
			continue;
		}

		if (message.role === "tool") {
			messages.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: message.toolCallId ?? "",
						content:
							typeof message.content === "string"
								? message.content
								: JSON.stringify(message.content ?? ""),
					},
				],
			});
			continue;
		}

		if (message.role === "assistant") {
			const blocks: Record<string, unknown>[] = [];
			blocks.push(
				...(anthropicThinkingFromProviderFields(message.providerFields) ?? []),
			);
			const content = contentToAnthropic(message.content);
			if (typeof content === "string" && content.length > 0)
				blocks.push({ type: "text", text: content });
			else if (Array.isArray(content)) blocks.push(...content);
			for (const toolCall of message.toolCalls ?? []) {
				blocks.push({
					type: "tool_use",
					id: toolCall.id,
					name: toolCall.name,
					input: parseToolArguments(toolCall.arguments),
				});
			}
			messages.push({ role: "assistant", content: blocks });
			continue;
		}

		messages.push({
			role: "user",
			content: contentToAnthropic(message.content),
		});
	}

	let system: string | Record<string, unknown>[] | undefined;
	if (systemBlocks.length > 0) {
		system = systemHasCacheControl
			? systemBlocks
			: systemBlocks.map((b) => b.text as string).join("\n\n");
	}

	return {
		...(system !== undefined ? { system } : {}),
		messages,
	};
}

function applyReasoning(
	body: Record<string, unknown>,
	req: CanonicalChatRequest,
	ctx: AdapterContext,
): void {
	const resolved = resolveAdapterReasoning(req, ctx, [
		"anthropic_adaptive",
		"anthropic_budget",
	]);
	if (resolved === undefined) return;
	const { effort } = resolved;
	const spec = ctx.meta.reasoning!;
	const display = summaryVisible(resolved.summary) ? "summarized" : "omitted";

	if (spec.kind === "anthropic_adaptive") {
		if (effort === "none") {
			// Claude Opus 5 enables adaptive thinking when the field is omitted. Emit the literal off
			// switch for every optional adaptive reasoner so canonical `none` stays provider-independent.
			body.thinking = { type: "disabled" };
			return;
		}
		body.thinking = { type: "adaptive", display };
		body.output_config = { effort: toUpstreamReasoningEffort(effort, spec) };
		return;
	}

	if (effort === "none") {
		body.thinking = { type: "disabled" };
		return;
	}
	const budget =
		spec.budgets?.[effort] ??
		(effort === "max" ? undefined : DEFAULT_ANTHROPIC_BUDGETS[effort]);
	if (budget === undefined) {
		throw new Error(
			'Anthropic budget-based reasoning requires an explicit budget for effort "max"',
		);
	}
	body.thinking = {
		type: "enabled",
		budget_tokens: budget,
		display,
	};
}

function applyResponseFormat(
	body: Record<string, unknown>,
	req: CanonicalChatRequest,
): void {
	const format = req.responseFormat;
	if (format === undefined || format.type === "text") return;
	const schema =
		format.type === "json_schema" ? format.schema : { type: "object" };
	const outputConfig = (body.output_config ?? {}) as Record<string, unknown>;
	body.output_config = {
		...outputConfig,
		format: { type: "json_schema", schema },
	};
}

function buildBody(
	req: CanonicalChatRequest,
	ctx: AdapterContext,
): Record<string, unknown> {
	if (req.n !== undefined && req.n > 1) {
		throw new GatewayError({
			class: "bad_request",
			message: "Anthropic adapter: n > 1 is not supported",
			param: "n",
		});
	}
	const nativeModel = FAST_MODE_ALIASES.get(ctx.upstreamModel);
	const body: Record<string, unknown> = {
		model: nativeModel ?? ctx.upstreamModel,
		max_tokens: req.maxTokens ?? ctx.meta.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
		stream: req.stream,
		...buildMessages(req),
	};
	if (nativeModel !== undefined) body.speed = "fast";
	if (req.temperature !== undefined) body.temperature = req.temperature;
	if (req.topP !== undefined) body.top_p = req.topP;
	if (req.topK !== undefined) body.top_k = req.topK;
	if (req.messagesTransport?.metadata !== undefined)
		body.metadata = req.messagesTransport.metadata;
	if (req.stop !== undefined) body.stop_sequences = req.stop;
	if (req.tools) {
		body.tools = req.tools.map((tool) => ({
			name: tool.name,
			...(tool.description !== undefined
				? { description: tool.description }
				: {}),
			input_schema: tool.parameters ?? { type: "object", properties: {} },
			...(tool.cacheControl !== undefined
				? { cache_control: tool.cacheControl }
				: {}),
		}));
	}
	if (req.toolChoice !== undefined) {
		if (req.toolChoice === "auto") body.tool_choice = { type: "auto" };
		else if (req.toolChoice === "none") body.tool_choice = { type: "none" };
		else if (req.toolChoice === "required") body.tool_choice = { type: "any" };
		else if ("name" in req.toolChoice)
			body.tool_choice = { type: "tool", name: req.toolChoice.name };
		else {
			const allowed = new Set(req.toolChoice.allowedTools);
			if (Array.isArray(body.tools))
				body.tools = body.tools.filter((tool) =>
					allowed.has(String((tool as { name?: unknown }).name ?? "")),
				);
			body.tool_choice = {
				type: req.toolChoice.mode === "required" ? "any" : "auto",
			};
		}
	}
	applyReasoning(body, req, ctx);
	applyResponseFormat(body, req);
	const extraBody = req.extraBody ? { ...req.extraBody } : undefined;
	if (extraBody !== undefined) {
		if (body.top_k === undefined && typeof extraBody.top_k === "number")
			body.top_k = extraBody.top_k;
		if (
			body.metadata === undefined &&
			extraBody.metadata !== null &&
			typeof extraBody.metadata === "object" &&
			!Array.isArray(extraBody.metadata)
		)
			body.metadata = extraBody.metadata;
		delete extraBody.top_k;
		delete extraBody.metadata;
	}
	return mergeExtraBody(body, extraBody, ANTHROPIC_BODY_MANAGED_KEYS);
}

function mapUsage(usage: AnthropicUsage | undefined): Usage {
	// Anthropic reports the three input buckets as DISJOINT: input_tokens is only the NON-cached part.
	// The canonical invariant requires cache read/write to be SUBSETS of promptTokens, so we add them
	// to the prompt (otherwise promptTokens would be undercounted and the write cost would be lost).
	const cacheRead = usage?.cache_read_input_tokens ?? 0;
	const cacheWrite = usage?.cache_creation_input_tokens ?? 0;
	const prompt = (usage?.input_tokens ?? 0) + cacheRead + cacheWrite;
	const completion = usage?.output_tokens ?? 0;
	const out: Usage = {
		promptTokens: prompt,
		completionTokens: completion,
		totalTokens: prompt + completion,
	};
	if (usage?.cache_read_input_tokens !== undefined)
		out.cacheReadTokens = cacheRead;
	if (usage?.cache_creation_input_tokens !== undefined)
		out.cacheWriteTokens = cacheWrite;
	return out;
}

function mapFinishReason(
	reason: string | null | undefined,
	hasToolCalls: boolean,
): CanonicalFinishReason | null {
	if (hasToolCalls) return "tool_calls";
	switch (reason) {
		case "end_turn":
		case "stop_sequence":
		case "pause_turn":
			return "stop";
		case "max_tokens":
		case "model_context_window_exceeded":
			return "length";
		case "tool_use":
			return "tool_calls";
		case "refusal":
			return "content_filter";
		case null:
		case undefined:
			return null;
		default: {
			const normalized = reason.toLowerCase();
			if (/max.?tokens?|context.?window|length/.test(normalized))
				return "length";
			if (/tool.?use|function.?call/.test(normalized)) return "tool_calls";
			if (/filter|safety|guardrail|block|prohibit|refus/.test(normalized))
				return "content_filter";
			return "stop";
		}
	}
}

function parseResponse(
	raw: unknown,
	ctx: AdapterContext,
): CanonicalChatResponse {
	const message = (raw ?? {}) as AnthropicMessage;
	const texts: string[] = [];
	const reasoning: string[] = [];
	const thinkingBlocks: AnthropicThinkingBlock[] = [];
	const toolCalls: NonNullable<
		CanonicalChatResponse["choices"][number]["message"]["toolCalls"]
	> = [];
	for (const block of message.content ?? []) {
		if (block.type === "text" && block.text !== undefined)
			texts.push(block.text);
		if (block.type === "thinking" && block.thinking !== undefined) {
			reasoning.push(block.thinking);
			if (typeof block.signature === "string")
				thinkingBlocks.push({
					type: "thinking",
					thinking: block.thinking,
					signature: block.signature,
				});
		}
		if (block.type === "redacted_thinking" && typeof block.data === "string")
			thinkingBlocks.push({ type: "redacted_thinking", data: block.data });
		if (block.type === "tool_use") {
			toolCalls.push({
				id: block.id ?? `toolu_${randomUUID()}`,
				name: block.name ?? "",
				arguments: JSON.stringify(block.input ?? {}),
			});
		}
	}
	const outMessage: CanonicalChatResponse["choices"][number]["message"] = {
		role: "assistant",
		content: texts.length > 0 ? texts.join("") : null,
	};
	if (reasoning.length > 0) outMessage.reasoning = reasoning.join("");
	if (thinkingBlocks.length > 0) {
		const providerFields = mergeProviderFields(
			outMessage.providerFields,
			providerFieldsWithAnthropicThinking(thinkingBlocks),
		);
		if (providerFields !== undefined)
			outMessage.providerFields = providerFields;
	}
	if (toolCalls.length > 0) outMessage.toolCalls = toolCalls;
	const response: CanonicalChatResponse = {
		id: message.id ?? `msg_${randomUUID()}`,
		created: Math.floor(Date.now() / 1000),
		model: message.model ?? ctx.upstreamModel,
		choices: [
			{
				index: 0,
				finishReason: mapFinishReason(
					message.stop_reason,
					toolCalls.length > 0,
				),
				message: outMessage,
			},
		],
		usage: mapUsage(message.usage),
	};
	return attachAdapterDiagnostics(response, {
		...(message.id ? { providerRequestId: message.id } : {}),
		...(message.model ? { modelVersion: message.model } : {}),
		...(message.stop_reason
			? { originalTerminalReason: message.stop_reason }
			: {}),
	});
}

function mapStreamError(event: AnthropicStreamEvent): GatewayError {
	const typ = event.error?.type;
	const message = event.error?.message ?? "Anthropic stream error";
	return new GatewayError({
		class:
			typ === "rate_limit_error" || typ === "overloaded_error"
				? "rate_limit"
				: "server",
		message,
		provider: { body: event },
	});
}

async function* parseStream(
	stream: ReadableStream<Uint8Array>,
	ctx: AdapterContext,
): AsyncGenerator<CanonicalChatStreamChunk> {
	let id = `msg_${randomUUID()}`;
	let model = ctx.upstreamModel;
	const created = Math.floor(Date.now() / 1000);
	// `inputTokens` is only the NON-cached part (Anthropic semantics). The final canonical usage adds
	// read+write to the prompt and exposes them as subsets (see mapUsage).
	let inputTokens = 0;
	let cacheReadTokens = 0;
	let cacheWriteTokens = 0;
	let completionTokens = 0;
	let pendingTerminal:
		| {
				finishReason: CanonicalFinishReason;
				originalTerminalReason: string;
				usage: Usage;
		  }
		| undefined;
	let messageStopped = false;
	const thinkingBlocks = new Map<number, AnthropicThinkingBlock>();
	const toolCallIndexes = new Map<number, number>();
	let nextToolCallIndex = 0;
	const toolCallIndex = (blockIndex: number): number => {
		const existing = toolCallIndexes.get(blockIndex);
		if (existing !== undefined) return existing;
		const index = nextToolCallIndex++;
		toolCallIndexes.set(blockIndex, index);
		return index;
	};

	for await (const sse of parseSSE(stream)) {
		let event: AnthropicStreamEvent;
		try {
			event = JSON.parse(sse.data) as AnthropicStreamEvent;
		} catch (cause) {
			throw new GatewayError({
				class: "server",
				code: "upstream_protocol_error",
				message: "Anthropic emitted malformed JSON in its stream",
				provider: { body: sse.data },
				cause,
			});
		}
		if (event.type === "error") throw mapStreamError(event);
		if (event.type === "message_start") {
			id = event.message?.id ?? id;
			model = event.message?.model ?? model;
			inputTokens = event.message?.usage?.input_tokens ?? inputTokens;
			cacheReadTokens =
				event.message?.usage?.cache_read_input_tokens ?? cacheReadTokens;
			cacheWriteTokens =
				event.message?.usage?.cache_creation_input_tokens ?? cacheWriteTokens;
			completionTokens =
				event.message?.usage?.output_tokens ?? completionTokens;
			yield attachAdapterDiagnostics(
				{
					id,
					created,
					model,
					choices: [
						{
							index: 0,
							delta: { role: "assistant" },
							finishReason: null,
						},
					],
				},
				{
					...(event.message?.id ? { providerRequestId: event.message.id } : {}),
					...(event.message?.model
						? { modelVersion: event.message.model }
						: {}),
				},
			);
			continue;
		}
		if (
			event.type === "content_block_start" &&
			event.content_block?.type === "tool_use"
		) {
			const index = toolCallIndex(event.index ?? 0);
			const toolCall: {
				index: number;
				id?: string;
				name?: string;
				arguments: string;
			} = {
				index,
				arguments: "",
			};
			if (event.content_block.id !== undefined)
				toolCall.id = event.content_block.id;
			if (event.content_block.name !== undefined)
				toolCall.name = event.content_block.name;
			yield {
				id,
				created,
				model,
				choices: [
					{
						index: 0,
						delta: {
							toolCalls: [toolCall],
						},
						finishReason: null,
					},
				],
			};
			continue;
		}
		if (event.type === "content_block_start") {
			const index = event.index ?? 0;
			if (event.content_block?.type === "thinking") {
				thinkingBlocks.set(index, {
					type: "thinking",
					thinking: event.content_block.thinking ?? "",
					signature: event.content_block.signature ?? "",
				});
				yield {
					id,
					created,
					model,
					choices: [
						{
							index: 0,
							delta: {
								providerFields: { anthropic: { thinking_stream: true } },
							},
							finishReason: null,
						},
					],
				};
				continue;
			}
			if (
				event.content_block?.type === "redacted_thinking" &&
				typeof event.content_block.data === "string"
			) {
				thinkingBlocks.set(index, {
					type: "redacted_thinking",
					data: event.content_block.data,
				});
				yield {
					id,
					created,
					model,
					choices: [
						{
							index: 0,
							delta: {
								providerFields: providerFieldsWithAnthropicThinking([
									thinkingBlocks.get(index)!,
								]),
							},
							finishReason: null,
						},
					],
				};
				thinkingBlocks.delete(index);
				continue;
			}
		}
		if (event.type === "content_block_delta") {
			if (
				event.delta?.type === "text_delta" &&
				event.delta.text !== undefined
			) {
				yield {
					id,
					created,
					model,
					choices: [
						{
							index: 0,
							delta: { content: event.delta.text },
							finishReason: null,
						},
					],
				};
			} else if (
				event.delta?.type === "thinking_delta" &&
				event.delta.thinking !== undefined
			) {
				const block = thinkingBlocks.get(event.index ?? 0);
				if (block?.type === "thinking") block.thinking += event.delta.thinking;
				yield {
					id,
					created,
					model,
					choices: [
						{
							index: 0,
							delta: { reasoning: event.delta.thinking },
							finishReason: null,
						},
					],
				};
			} else if (
				event.delta?.type === "signature_delta" &&
				event.delta.signature !== undefined
			) {
				const block = thinkingBlocks.get(event.index ?? 0);
				if (block?.type === "thinking")
					block.signature += event.delta.signature;
			} else if (
				event.delta?.type === "input_json_delta" &&
				event.delta.partial_json !== undefined
			) {
				const index = toolCallIndex(event.index ?? 0);
				yield {
					id,
					created,
					model,
					choices: [
						{
							index: 0,
							delta: {
								toolCalls: [
									{
										index,
										arguments: event.delta.partial_json,
									},
								],
							},
							finishReason: null,
						},
					],
				};
			}
			continue;
		}
		if (event.type === "content_block_stop") {
			const index = event.index ?? 0;
			const block = thinkingBlocks.get(index);
			if (block !== undefined) {
				thinkingBlocks.delete(index);
				yield {
					id,
					created,
					model,
					choices: [
						{
							index: 0,
							delta: {
								providerFields: providerFieldsWithAnthropicThinking([block]),
							},
							finishReason: null,
						},
					],
				};
			}
			continue;
		}
		if (event.type === "message_delta") {
			if (pendingTerminal)
				throw new GatewayError({
					class: "server",
					code: "upstream_protocol_error",
					message: "Anthropic emitted more than one terminal message_delta",
				});
			completionTokens = event.usage?.output_tokens ?? completionTokens;
			const finishReason = mapFinishReason(
				event.delta?.stop_reason,
				event.delta?.stop_reason === "tool_use",
			);
			if (finishReason === null)
				throw new GatewayError({
					class: "server",
					code: "upstream_protocol_error",
					message: "Anthropic terminal message_delta omitted stop_reason",
				});
			const promptTokens = inputTokens + cacheReadTokens + cacheWriteTokens;
			const usage: Usage = {
				promptTokens,
				completionTokens,
				totalTokens: promptTokens + completionTokens,
			};
			if (cacheReadTokens > 0) usage.cacheReadTokens = cacheReadTokens;
			if (cacheWriteTokens > 0) usage.cacheWriteTokens = cacheWriteTokens;
			pendingTerminal = {
				finishReason,
				originalTerminalReason: event.delta?.stop_reason ?? "unknown",
				usage,
			};
			continue;
		}
		if (event.type === "message_stop") {
			if (messageStopped || !pendingTerminal)
				throw new GatewayError({
					class: "server",
					code: "upstream_protocol_error",
					message: "Anthropic emitted an invalid message_stop sequence",
				});
			messageStopped = true;
			yield attachAdapterDiagnostics(
				{
					id,
					created,
					model,
					choices: [
						{
							index: 0,
							delta: {},
							finishReason: pendingTerminal.finishReason,
						},
					],
					usage: pendingTerminal.usage,
				},
				{
					originalTerminalReason: pendingTerminal.originalTerminalReason,
				},
			);
			continue;
		}
		const metadataChunk: CanonicalChatStreamChunk = {
			id,
			created,
			model,
			choices: [],
		};
		if (event.type !== "ping")
			recordUnknownAdapterEvent(
				adapterContextDiagnostics(ctx),
				event.type ?? "missing_type",
			);
		yield attachAdapterDiagnostics(metadataChunk, {
			metadata:
				event.type === "ping"
					? { heartbeat: true }
					: { unknownEvents: [event.type ?? "missing_type"] },
		});
	}
}

function mapError(err: unknown, ctx: AdapterContext): GatewayError {
	return mapUpstreamHttpError(
		err,
		{
			label: "Anthropic",
			// Anthropic classifies by `error.type` before looking at the HTTP status.
			classifyBody: (_status, body) => {
				const typ = (body as { error?: { type?: string } })?.error?.type;
				if (typ === "rate_limit_error" || typ === "overloaded_error")
					return "rate_limit";
				if (typ === "authentication_error" || typ === "permission_error")
					return "auth";
				return null;
			},
			refineBadRequest: (message) =>
				looksLikeContextWindowError(message) ? "context_window" : null,
		},
		ctx,
	);
}

function addBetaHeader(headers: Record<string, string>, beta: string): void {
	const betaName = Object.keys(headers).find(
		(name) => name.toLowerCase() === "anthropic-beta",
	);
	if (betaName === undefined) {
		headers["anthropic-beta"] = beta;
		return;
	}
	const betas = headers[betaName]!.split(",").map((value) => value.trim());
	if (!betas.includes(beta)) headers[betaName] = `${headers[betaName]},${beta}`;
}

const chat: ChatHandler = {
	buildRequest(req, ctx) {
		const c = creds(ctx);
		const base = (c.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
		const headers: Record<string, string> = {
			"content-type": "application/json",
			"x-api-key": c.apiKey,
			"anthropic-version": c.version ?? DEFAULT_VERSION,
			...(c.headers ?? {}),
		};
		if (FAST_MODE_ALIASES.has(ctx.upstreamModel)) {
			addBetaHeader(headers, FAST_MODE_BETA);
		}
		if (requestUsesProviderFileId(req)) {
			addBetaHeader(headers, "files-api-2025-04-14");
		}
		return {
			method: "POST",
			url: `${base}/messages`,
			headers,
			body: JSON.stringify(buildBody(req, ctx)),
		};
	},
	parseResponse,
	parseStream,
	mapError,
};

export const anthropicAdapter: Adapter = {
	key: "anthropic",
	credentials: { required: ["apiKey"] },
	supportedCallTypes: new Set(["chat"]),
	chat,
	reasoningKinds: new Set<ReasoningControlKind>([
		"anthropic_adaptive",
		"anthropic_budget",
	]),
	contentInputs: {
		messages: {
			file: {
				sources: ["provider_file_id", "url", "data_url"],
				mimeTypes: ["application/pdf"],
				maxBytes: 32_000_000,
			},
			image: {
				sources: ["url", "data_url"],
				mimeTypes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
			},
		},
	},
	transports: { chat: { supported: ["messages"], default: "messages" } },
};

export const anthropicProvider: ProviderModule = { adapter: anthropicAdapter };
