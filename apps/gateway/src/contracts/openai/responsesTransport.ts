/**
 * OpenAI Responses API as an UPSTREAM TRANSPORT. Used by the `openai` adapter (whose native transport
 * is /responses) to talk to the provider: translates the canonical request to the /responses body, and
 * parses the /responses response/events back into canonical types.
 *
 * (responsesRender.ts is the EDGE with the client; responsesTransport.ts is the transport with the PROVIDER.)
 *
 * Parameters managed by the gateway (previous_response_id, item_reference, background) do NOT
 * exist in the canonical type, so they are never forwarded to the upstream. `store` is always set
 * to false: the gateway keeps no state with the provider, and OpenAI only returns encrypted
 * reasoning content for unstored responses.
 */

import { mergeExtraBody } from "#core/extraBody.ts";
import { GatewayError } from "#core/errors.ts";
import type { SSEEvent } from "#core/sse.ts";
import type { Usage } from "#core/usage.ts";
import { randomUUID } from "node:crypto";

import {
	providerFieldsWithOpenAIResponsesStreamOutput,
	providerFieldsWithOpenAIResponsesStreamEvent,
	providerFieldsWithOpenAIReasoningItemId,
	providerFieldsWithResponsesOutput,
	providerFieldsWithOpenAIReasoning,
	openaiReasoningFromProviderFields,
	type OpenAIReasoningStateItem,
	mergeProviderFields,
} from "#core/providerSpecificFields.ts";

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
	toUpstreamReasoningEffort,
	type ResolvedReasoning,
	type ReasoningSpec,
	resolveReasoning,
	summaryVisible,
} from "#core/reasoning.ts";

import {
	mirrorReasoningEventData,
	reasoningItemForRequest,
	mirrorReasoningOutput,
	reasoningTextFromItem,
} from "./responsesReasoning.ts";

const ENCRYPTED_REASONING_INCLUDE = "reasoning.encrypted_content";

const OPENAI_RESPONSES_TRANSPORT_MANAGED_KEYS = [
	"store",
	"model",
	"input",
	"stream",
	"instructions",
	"max_output_tokens",
	"temperature",
	"top_p",
	"presence_penalty",
	"frequency_penalty",
	"parallel_tool_calls",
	"tools",
	"tool_choice",
	"include",
	"metadata",
	"text",
	"reasoning",
	"stream_options",
	"service_tier",
	"safety_identifier",
	"prompt_cache_key",
	"top_logprobs",
	"max_tool_calls",
	"user",
	"truncation",
	"context_management",
] as const;

/* ------------------------------------------------- canonical -> /responses body */

function resolveOpenAIReasoning(
	req: CanonicalChatRequest,
	spec: ReasoningSpec | undefined,
): ResolvedReasoning | undefined {
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
	if (spec.kind !== "openai_effort") {
		throw new GatewayError({
			class: "bad_request",
			message: `Reasoning control "${spec.kind}" cannot be emitted as OpenAI reasoning.effort`,
			code: "unsupported_model_capability",
			param: "reasoning",
		});
	}
	return resolveReasoning(req.reasoning, spec);
}

function toResponsesTextFormat(
	format: CanonicalResponseFormat,
): Record<string, unknown> {
	if (format.type !== "json_schema") return { type: format.type };
	return {
		type: "json_schema",
		name: format.name ?? "structured_output",
		schema: format.schema,
		...(format.description !== undefined
			? { description: format.description }
			: {}),
		...(format.strict !== undefined ? { strict: format.strict } : {}),
	};
}

function partToInput(
	p: CanonicalContentPart,
	role: "user" | "assistant",
): Record<string, unknown> | null {
	switch (p.type) {
		case "text":
			return {
				type: role === "assistant" ? "output_text" : "input_text",
				text: p.text,
			};
		case "image":
			return {
				type: "input_image",
				image_url: p.url,
				detail: p.detail ?? "auto",
			};
		case "file":
			return {
				type: "input_file",
				...(p.fileId !== undefined ? { file_id: p.fileId } : {}),
				...(p.fileUrl !== undefined ? { file_url: p.fileUrl } : {}),
				...(p.fileData !== undefined ? { file_data: p.fileData } : {}),
				...(p.filename !== undefined ? { filename: p.filename } : {}),
				...(p.detail !== undefined ? { detail: p.detail } : {}),
			};
		case "audio":
			return {
				type: "input_audio",
				input_audio: { data: p.data, format: p.format },
			};
	}
}

function contentToInput(
	content: CanonicalMessage["content"],
	role: "user" | "assistant",
): Record<string, unknown>[] {
	if (content === null) return [];
	if (typeof content === "string") {
		return [
			{
				type: role === "assistant" ? "output_text" : "input_text",
				text: content,
			},
		];
	}
	return content
		.map((p) => partToInput(p, role))
		.filter((x): x is Record<string, unknown> => x !== null);
}

export function buildResponsesRequestBody(
	req: CanonicalChatRequest,
	upstreamModel: string,
	reasoningSpec?: ReasoningSpec,
): Record<string, unknown> {
	const input: Record<string, unknown>[] = [];
	const instructions: string[] = [];

	for (const m of req.messages) {
		if (m.role === "system" || m.role === "developer") {
			if (typeof m.content === "string") instructions.push(m.content);
			else if (Array.isArray(m.content)) {
				instructions.push(
					m.content
						.filter((p) => p.type === "text")
						.map((p) => (p as { text: string }).text)
						.join("\n"),
				);
			}
			continue;
		}
		if (m.role === "tool") {
			const output =
				typeof m.content === "string"
					? m.content
					: m.content === null
						? ""
						: contentToInput(m.content, "user");
			input.push({
				type: "function_call_output",
				call_id: m.toolCallId ?? "",
				output:
					m.toolResultError === true
						? typeof output === "string"
							? `[Tool execution failed] ${output}`
							: [
									{
										type: "input_text",
										text: "[Tool execution failed]",
									},
									...output,
								]
						: output,
			});
			continue;
		}
		if (m.role === "assistant") {
			// Replay encrypted reasoning state before the items it belongs to (OpenAI requires
			// reasoning items to precede the function calls they preceded originally).
			for (const item of openaiReasoningFromProviderFields(m.providerFields) ??
				[]) {
				input.push(reasoningItemForRequest(item));
			}
			if (m.content)
				input.push({
					type: "message",
					role: "assistant",
					content: contentToInput(m.content, "assistant"),
					...(m.phase !== undefined ? { phase: m.phase } : {}),
				});
			for (const tc of m.toolCalls ?? []) {
				input.push({
					type: "function_call",
					call_id: tc.id,
					name: tc.name,
					arguments: tc.arguments,
				});
			}
			continue;
		}
		input.push({
			type: "message",
			role: "user",
			content: contentToInput(m.content, "user"),
		});
	}

	const body: Record<string, unknown> = {
		model: upstreamModel,
		input: req.responsesTransport?.rawInput ?? input,
		stream: req.stream,
	};
	if (instructions.length > 0) body.instructions = instructions.join("\n");
	if (req.maxTokens !== undefined) body.max_output_tokens = req.maxTokens;
	if (req.temperature !== undefined) body.temperature = req.temperature;
	if (req.topP !== undefined) body.top_p = req.topP;
	if (req.presencePenalty !== undefined)
		body.presence_penalty = req.presencePenalty;
	if (req.frequencyPenalty !== undefined)
		body.frequency_penalty = req.frequencyPenalty;
	if (req.responsesTransport?.user !== undefined)
		body.user = req.responsesTransport.user;
	if (req.responsesTransport?.truncation !== undefined)
		body.truncation = req.responsesTransport.truncation;
	if (req.responsesTransport?.contextManagement !== undefined)
		body.context_management = req.responsesTransport.contextManagement;
	if (req.parallelToolCalls !== undefined)
		body.parallel_tool_calls = req.parallelToolCalls;
	if (req.responsesTransport?.rawTools) {
		body.tools = req.responsesTransport.rawTools;
	} else if (req.tools) {
		body.tools = req.tools.map((t) => ({
			type: "function",
			name: t.name,
			...(t.description !== undefined ? { description: t.description } : {}),
			...(t.parameters !== undefined ? { parameters: t.parameters } : {}),
			...(t.strict !== undefined ? { strict: t.strict } : {}),
		}));
	}
	if (req.toolChoice !== undefined) {
		if (typeof req.toolChoice === "string") body.tool_choice = req.toolChoice;
		else if ("name" in req.toolChoice)
			body.tool_choice = { type: "function", name: req.toolChoice.name };
		else
			body.tool_choice = {
				type: "allowed_tools",
				mode: req.toolChoice.mode,
				tools: req.toolChoice.allowedTools.map((name) => ({
					type: "function",
					name,
				})),
			};
	}
	// Encrypted reasoning state: request it for reasoning-capable models so multi-turn tool flows
	// can replay it. OpenAI only returns encrypted_content for unstored responses; the gateway is
	// stateless with the upstream by design (it never uses upstream previous_response_id), so the
	// upstream call is always store:false.
	body.store = false;
	const include = [...(req.responsesTransport?.include ?? [])];
	if (
		reasoningSpec?.kind === "openai_effort" &&
		!include.includes(ENCRYPTED_REASONING_INCLUDE)
	)
		include.push(ENCRYPTED_REASONING_INCLUDE);
	if (include.length > 0) body.include = include;
	if (req.responsesTransport?.metadata !== undefined)
		body.metadata = req.responsesTransport.metadata;
	const text = { ...(req.responsesTransport?.text ?? {}) };
	if (req.responseFormat !== undefined)
		text.format = toResponsesTextFormat(req.responseFormat);
	if (Object.keys(text).length > 0) body.text = text;
	const resolvedReasoning = resolveOpenAIReasoning(req, reasoningSpec);
	if (
		req.responsesTransport?.reasoning !== undefined ||
		resolvedReasoning !== undefined
	) {
		body.reasoning = {
			...(req.responsesTransport?.reasoning ?? {}),
			...(resolvedReasoning !== undefined
				? {
						effort: toUpstreamReasoningEffort(
							resolvedReasoning.effort,
							reasoningSpec!,
						),
					}
				: {}),
			...(resolvedReasoning && summaryVisible(resolvedReasoning.summary)
				? { summary: resolvedReasoning.summary }
				: {}),
		};
	}
	if (req.responsesTransport?.streamOptions !== undefined)
		body.stream_options = req.responsesTransport.streamOptions;
	if (req.responsesTransport?.serviceTier !== undefined)
		body.service_tier = req.responsesTransport.serviceTier;
	if (req.responsesTransport?.safetyIdentifier !== undefined)
		body.safety_identifier = req.responsesTransport.safetyIdentifier;
	// The /responses contract carries it in responsesTransport; a /chat request routed to this
	// transport (OpenAI uses /responses as its native transport) carries it in the top-level promptCacheKey.
	const promptCacheKey =
		req.responsesTransport?.promptCacheKey ?? req.promptCacheKey;
	if (promptCacheKey !== undefined) body.prompt_cache_key = promptCacheKey;
	if (req.responsesTransport?.topLogprobs !== undefined)
		body.top_logprobs = req.responsesTransport.topLogprobs;
	if (req.responsesTransport?.maxToolCalls !== undefined)
		body.max_tool_calls = req.responsesTransport.maxToolCalls;
	return mergeExtraBody(
		body,
		req.extraBody,
		OPENAI_RESPONSES_TRANSPORT_MANAGED_KEYS,
	);
}

/* ------------------------------------------------- /responses -> canonical */

interface RWUsage {
	input_tokens?: number;
	output_tokens?: number;
	total_tokens?: number;
	input_tokens_details?: { cached_tokens?: number };
	output_tokens_details?: { reasoning_tokens?: number };
}

function mapUsage(u: RWUsage | undefined | null): Usage {
	const usage: Usage = {
		promptTokens: u?.input_tokens ?? 0,
		completionTokens: u?.output_tokens ?? 0,
		totalTokens: u?.total_tokens ?? 0,
	};
	if (u?.input_tokens_details?.cached_tokens !== undefined)
		usage.cacheReadTokens = u.input_tokens_details.cached_tokens;
	if (u?.output_tokens_details?.reasoning_tokens !== undefined)
		usage.reasoningTokens = u.output_tokens_details.reasoning_tokens;
	return usage;
}

interface RWOutputItem {
	[key: string]: unknown;
	type?: string;
	content?: Array<{ type?: string; text?: string }>;
	summary?: Array<{ type?: string; text?: string } | string>;
	call_id?: string;
	id?: string;
	name?: string;
	arguments?: string;
	phase?: "commentary" | "final_answer";
	extra_content?: Record<string, unknown>;
	encrypted_content?: string;
}

function reasoningStateFromItem(
	item: RWOutputItem,
): OpenAIReasoningStateItem | undefined {
	if (item.type !== "reasoning") return undefined;
	if (
		typeof item.encrypted_content !== "string" ||
		item.encrypted_content.length === 0
	)
		return undefined;
	return {
		encrypted_content: item.encrypted_content,
		...(typeof item.id === "string" && item.id.length > 0
			? { id: item.id }
			: {}),
		...(Array.isArray(item.summary)
			? { summary: structuredClone(item.summary) }
			: {}),
		...(Array.isArray(item.content)
			? { content: structuredClone(item.content) }
			: {}),
	};
}
interface RWResponse {
	id?: string;
	created_at?: number;
	model?: string;
	status?: string;
	incomplete_details?: { reason?: string };
	output?: RWOutputItem[];
	usage?: RWUsage;
	error?: Record<string, unknown>;
}

function finishFrom(
	r: RWResponse,
	hasToolCalls: boolean,
): CanonicalFinishReason {
	if (r.status === "incomplete") {
		return r.incomplete_details?.reason === "max_output_tokens"
			? "length"
			: "content_filter";
	}
	if (hasToolCalls) return "tool_calls";
	return "stop";
}

export function parseResponsesResponse(raw: unknown): CanonicalChatResponse {
	const r = (raw ?? {}) as RWResponse;
	if (r.status === "failed")
		throw new GatewayError({
			class: "server",
			code: "upstream_response_failed",
			message: "Responses upstream returned a failed response",
			provider: { body: r.error ?? raw },
		});
	if (r.status !== "completed" && r.status !== "incomplete")
		throw new GatewayError({
			class: "server",
			code: "upstream_protocol_error",
			message: "Responses upstream omitted a recognized terminal status",
			provider: { body: { status: r.status ?? null } },
		});
	let content = "";
	const reasoning: string[] = [];
	const reasoningState: OpenAIReasoningStateItem[] = [];
	const toolCalls: NonNullable<
		CanonicalChatResponse["choices"][number]["message"]["toolCalls"]
	> = [];
	const output = mirrorReasoningOutput(
		(r.output ?? []) as unknown as Record<string, unknown>[],
	) as RWOutputItem[];
	for (const item of output) {
		if (item.type === "message") {
			for (const c of item.content ?? [])
				if (c.type === "output_text") content += c.text ?? "";
		} else if (item.type === "reasoning") {
			reasoning.push(...reasoningTextFromItem(item));
			const state = reasoningStateFromItem(item);
			if (state !== undefined) reasoningState.push(state);
		} else if (item.type === "function_call") {
			toolCalls.push({
				id: item.call_id ?? item.id ?? "",
				name: item.name ?? "",
				arguments: item.arguments ?? "",
				...(item.extra_content !== undefined
					? { extraContent: item.extra_content }
					: {}),
			});
		}
	}
	const message: CanonicalChatResponse["choices"][number]["message"] = {
		role: "assistant",
		content: content.length > 0 ? content : null,
	};
	const responseMessage = output.find(
		(item) => item.type === "message" && item.phase !== undefined,
	);
	if (responseMessage?.phase !== undefined)
		message.phase = responseMessage.phase;
	if (reasoning.length > 0) message.reasoning = reasoning.join("\n\n");
	if (reasoningState.length > 0)
		message.providerFields = providerFieldsWithOpenAIReasoning(reasoningState);
	if (output.length > 0) {
		const providerFields = mergeProviderFields(
			message.providerFields,
			providerFieldsWithResponsesOutput(output),
		);
		if (providerFields !== undefined) message.providerFields = providerFields;
	}
	if (toolCalls.length > 0) message.toolCalls = toolCalls;
	return {
		id: r.id ?? `resp-${randomUUID()}`,
		created: r.created_at ?? Math.floor(Date.now() / 1000),
		model: r.model ?? "",
		choices: [
			{ index: 0, finishReason: finishFrom(r, toolCalls.length > 0), message },
		],
		usage: mapUsage(r.usage),
	};
}

/* ------------------------------------------------- /responses SSE -> canonical chunks */

export async function* responsesEventsToCanonicalChunks(
	events: AsyncIterable<SSEEvent>,
	options?: {
		onUnknownEvent?: (type: string) => void;
		onTransportTerminator?: (terminator: "done_marker") => void;
		onTerminalEvent?: (
			type: "response.completed" | "response.incomplete",
			originalReason: string,
			normalizedReason: CanonicalFinishReason,
		) => void;
	},
): AsyncGenerator<CanonicalChatStreamChunk> {
	const created = Math.floor(Date.now() / 1000);
	let id = "";
	let model = "";
	let roleSent = false;
	// Encrypted reasoning item ids already forwarded as delta.providerFields (dedupes the final
	// response against per-item events).
	const reasoningStateSeen = new Set<string>();

	const base = () => ({ id, created, model });

	let terminalSeen = false;
	const reasoningLanes = new Map<string, "content" | "summary">();
	const selectReasoningLane = (
		data: Record<string, unknown>,
		lane: "content" | "summary",
	): boolean => {
		const key =
			typeof data.item_id === "string" && data.item_id.length > 0
				? `id:${data.item_id}`
				: typeof data.output_index === "number" &&
						Number.isInteger(data.output_index) &&
						data.output_index >= 0
					? `index:${data.output_index}`
					: undefined;
		if (key === undefined) return true;
		const selectedLane = reasoningLanes.get(key);
		if (selectedLane !== undefined && selectedLane !== lane) return false;
		reasoningLanes.set(key, lane);
		return true;
	};
	for await (const ev of events) {
		if (ev.data === "[DONE]") {
			options?.onTransportTerminator?.("done_marker");
			return;
		}
		let d: Record<string, unknown>;
		try {
			d = mirrorReasoningEventData(
				JSON.parse(ev.data) as Record<string, unknown>,
			);
		} catch (cause) {
			throw new GatewayError({
				class: "server",
				code: "upstream_protocol_error",
				message: "Responses upstream emitted malformed JSON",
				provider: { body: ev.data },
				cause,
			});
		}
		const type = (ev.event ?? d.type) as string | undefined;
		if (terminalSeen)
			throw new GatewayError({
				class: "server",
				code: "upstream_protocol_error",
				message: "Responses upstream emitted an event after its terminal event",
				provider: { body: { type: type ?? null } },
			});
		if (type === "error" || type === "response.failed") {
			const response = d.response as Record<string, unknown> | undefined;
			const error = (d.error ?? response?.error ?? d) as
				| Record<string, unknown>
				| undefined;
			const code =
				typeof error?.code === "string" ? error.code : "upstream_stream_error";
			const providerStatus =
				typeof d.status === "number"
					? d.status
					: typeof response?.status === "number"
						? response.status
						: 502;
			const param = typeof error?.param === "string" ? error.param : null;
			throw new GatewayError({
				class:
					code === "previous_response_not_found" ? "bad_request" : "server",
				code,
				param,
				message: "Responses upstream emitted a terminal stream error",
				provider: { status: providerStatus, body: error },
				...(code === "previous_response_not_found"
					? { deploymentHealth: "neutral" as const }
					: {}),
			});
		}

		if (type === "response.created" || type === "response.in_progress") {
			const resp = d.response as { id?: string; model?: string } | undefined;
			if (resp?.id) id = resp.id;
			if (resp?.model) model = resp.model;
			continue;
		}

		if (type === "response.output_text.delta") {
			const delta: CanonicalChatStreamChunk["choices"][number]["delta"] = {
				providerFields: providerFieldsWithOpenAIResponsesStreamEvent(type, d),
			};
			if (!roleSent) {
				delta.role = "assistant";
				roleSent = true;
			}
			delta.content = String(d.delta ?? "");
			yield { ...base(), choices: [{ index: 0, delta, finishReason: null }] };
			continue;
		}

		if (
			type === "response.reasoning_summary_text.delta" ||
			type === "response.reasoning_summary.delta" ||
			type === "response.reasoning_text.delta" ||
			type === "response.reasoning.delta"
		) {
			const lane = type.includes("summary") ? "summary" : "content";
			if (!selectReasoningLane(d, lane)) continue;
			const delta: CanonicalChatStreamChunk["choices"][number]["delta"] = {};
			delta.providerFields = providerFieldsWithOpenAIResponsesStreamEvent(
				type,
				d,
			);
			if (!roleSent) {
				delta.role = "assistant";
				roleSent = true;
			}
			delta.reasoning = String(d.delta ?? "");
			if (typeof d.item_id === "string" && d.item_id.length > 0)
				delta.providerFields = mergeProviderFields(
					delta.providerFields,
					providerFieldsWithOpenAIReasoningItemId(d.item_id),
				)!;
			yield { ...base(), choices: [{ index: 0, delta, finishReason: null }] };
			continue;
		}

		if (
			type === "response.reasoning_summary_text.done" ||
			type === "response.reasoning_text.done" ||
			type === "response.reasoning_summary.done" ||
			type === "response.reasoning.done"
		) {
			const lane = type.includes("summary") ? "summary" : "content";
			if (!selectReasoningLane(d, lane)) continue;
			yield {
				...base(),
				choices: [
					{
						index: 0,
						delta: {
							providerFields: providerFieldsWithOpenAIResponsesStreamEvent(
								type,
								d,
							),
						},
						finishReason: null,
					},
				],
			};
			continue;
		}

		if (type === "response.output_item.added") {
			const item = d.item as RWOutputItem | undefined;
			const delta: CanonicalChatStreamChunk["choices"][number]["delta"] = {
				providerFields: providerFieldsWithOpenAIResponsesStreamEvent(type, d),
			};
			if (item?.type === "function_call") {
				const idx = Number(d.output_index ?? 0);
				delta.toolCalls = [
					{
						index: idx,
						id: item.call_id ?? "",
						name: item.name ?? "",
						arguments: "",
						...(item.extra_content !== undefined
							? { extraContent: item.extra_content }
							: {}),
					},
				];
			}
			yield {
				...base(),
				choices: [{ index: 0, delta, finishReason: null }],
			};
			continue;
		}

		if (type === "response.function_call_arguments.delta") {
			const idx = Number(d.output_index ?? 0);
			yield {
				...base(),
				choices: [
					{
						index: 0,
						delta: {
							toolCalls: [{ index: idx, arguments: String(d.delta ?? "") }],
							providerFields: providerFieldsWithOpenAIResponsesStreamEvent(
								type,
								d,
							),
						},
						finishReason: null,
					},
				],
			};
			continue;
		}

		if (type === "response.output_item.done") {
			const item = d.item as RWOutputItem | undefined;
			const state =
				item !== undefined ? reasoningStateFromItem(item) : undefined;
			let providerFields = providerFieldsWithOpenAIResponsesStreamEvent(
				type,
				d,
			);
			if (
				state !== undefined &&
				(state.id === undefined || !reasoningStateSeen.has(state.id))
			) {
				if (state.id !== undefined) reasoningStateSeen.add(state.id);
				providerFields = mergeProviderFields(
					providerFields,
					providerFieldsWithOpenAIReasoning([state]),
				)!;
			}
			if (
				item !== undefined &&
				item.type !== "message" &&
				item.type !== "reasoning" &&
				item.type !== "function_call"
			) {
				providerFields = mergeProviderFields(
					providerFields,
					providerFieldsWithResponsesOutput([
						item as unknown as Record<string, unknown>,
					]),
				)!;
			}
			yield {
				...base(),
				choices: [{ index: 0, delta: { providerFields }, finishReason: null }],
			};
			continue;
		}

		if (type === "response.completed" || type === "response.incomplete") {
			terminalSeen = true;
			const r = (d.response ?? {}) as RWResponse;
			const output = mirrorReasoningOutput(
				(r.output ?? []) as unknown as Record<string, unknown>[],
			) as RWOutputItem[];
			// Belt and braces: forward any encrypted reasoning state that did not stream as its own
			// output_item.done event.
			const missed = output
				.map(reasoningStateFromItem)
				.filter(
					(state): state is OpenAIReasoningStateItem =>
						state !== undefined &&
						(state.id === undefined || !reasoningStateSeen.has(state.id)),
				);
			if (missed.length > 0) {
				for (const state of missed)
					if (state.id !== undefined) reasoningStateSeen.add(state.id);
				yield {
					...base(),
					choices: [
						{
							index: 0,
							delta: {
								providerFields: providerFieldsWithOpenAIReasoning(missed),
							},
							finishReason: null,
						},
					],
				};
			}
			const hasTool = output.some((it) => it.type === "function_call");
			const finishReason = finishFrom(r, hasTool);
			options?.onTerminalEvent?.(
				type,
				r.incomplete_details?.reason ?? type,
				finishReason,
			);
			yield {
				...base(),
				choices: [
					{
						index: 0,
						delta: {
							providerFields:
								providerFieldsWithOpenAIResponsesStreamOutput(output),
						},
						finishReason,
					},
				],
				usage: mapUsage(r.usage),
			};
			continue;
		}

		if (type?.startsWith("response.") && type !== "response.queued") {
			yield {
				...base(),
				choices: [
					{
						index: 0,
						delta: {
							providerFields: providerFieldsWithOpenAIResponsesStreamEvent(
								type,
								d,
							),
						},
						finishReason: null,
					},
				],
			};
		} else {
			options?.onUnknownEvent?.(type ?? "missing_type");
			yield { ...base(), choices: [] };
		}
	}
}
