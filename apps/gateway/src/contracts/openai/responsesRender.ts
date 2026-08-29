import { fileParserOptionsFromPlugins } from "#contracts/fileParser.ts";
import { assertNoManagedExtraBodyKeys } from "#core/extraBody.ts";
import type { ResponsesRequest } from "./responses.ts";
import { GatewayError } from "#core/errors.ts";
import type { SSEEvent } from "#core/sse.ts";
import type { Usage } from "#core/usage.ts";
import { randomUUID } from "node:crypto";

import {
	openaiResponsesStreamOutputFromProviderFields,
	openaiResponsesStreamEventFromProviderFields,
	openaiReasoningItemIdFromProviderFields,
	providerSpecificFieldsFromExtraContent,
	extraContentFromProviderSpecificFields,
	withoutOpenAIResponsesReasoningState,
	responsesOutputFromProviderFields,
	providerFieldsWithOpenAIReasoning,
	openaiReasoningFromProviderFields,
	type OpenAIReasoningStateItem,
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
	CanonicalFinishReason,
	CanonicalChatRequest,
	CanonicalContentPart,
	CanonicalToolChoice,
	CanonicalMessage,
	CanonicalRole,
} from "#core/canonical.ts";

import {
	mirrorReasoningEventData,
	mirrorReasoningOutput,
	mirrorReasoningItem,
} from "./responsesReasoning.ts";

import {
	type ReasoningSummary,
	isReasoningEffort,
	summaryForEffort,
} from "#core/reasoning.ts";

/* =====================================================================
 * OpenResponses ⟷ canonical types (provider-agnostic render).
 * /v1/responses translates the request to canonical, calls the adapter (chat), and
 * renders the canonical result back to the OpenResponses contract.
 * ===================================================================== */

const RESPONSES_EXTRA_BODY_MANAGED_KEYS = [
	"model",
	"input",
	"instructions",
	"previous_response_id",
	"stream",
	"store",
	"background",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"reasoning",
	"text",
	"include",
	"truncation",
	"max_output_tokens",
	"max_tool_calls",
	"temperature",
	"top_p",
	"presence_penalty",
	"frequency_penalty",
	"metadata",
	"service_tier",
	"stream_options",
	"safety_identifier",
	"prompt_cache_key",
	"top_logprobs",
	"user",
	"plugins",
	"conversation",
	"context_management",
	"prompt",
	"extra_body",
] as const;
const ENCRYPTED_REASONING_INCLUDE = "reasoning.encrypted_content";

function stripEncryptedReasoningItem(
	item: Record<string, unknown>,
): Record<string, unknown> {
	if (item.type !== "reasoning" || !("encrypted_content" in item)) return item;
	const copy = structuredClone(item);
	delete copy.encrypted_content;
	return copy;
}

export function responseForClient(
	response: Record<string, unknown>,
	include: string[] | undefined,
): Record<string, unknown> {
	if (include?.includes(ENCRYPTED_REASONING_INCLUDE)) return response;
	const copy = structuredClone(response);
	if (Array.isArray(copy.output))
		copy.output = copy.output.map((item) =>
			item !== null && typeof item === "object" && !Array.isArray(item)
				? stripEncryptedReasoningItem(item as Record<string, unknown>)
				: item,
		);
	return copy;
}

export function responseEventForClient(
	event: SSEEvent,
	include: string[] | undefined,
): SSEEvent {
	if (include?.includes(ENCRYPTED_REASONING_INCLUDE)) return event;
	let data: Record<string, unknown>;
	try {
		data = JSON.parse(event.data) as Record<string, unknown>;
	} catch {
		return event;
	}
	if (
		data.item !== null &&
		typeof data.item === "object" &&
		!Array.isArray(data.item)
	)
		data.item = stripEncryptedReasoningItem(
			data.item as Record<string, unknown>,
		);
	if (
		data.response !== null &&
		typeof data.response === "object" &&
		!Array.isArray(data.response)
	)
		data.response = responseForClient(
			data.response as Record<string, unknown>,
			include,
		);
	return { ...event, data: JSON.stringify(data) };
}

/* ---------------------------------------------- request -> canonical */

function mapInputPart(
	part: Record<string, unknown>,
): CanonicalContentPart | null {
	const type = part.type as string | undefined;
	switch (type) {
		case "input_text":
		case "output_text":
		case "text":
			return { type: "text", text: String(part.text ?? "") };
		case "input_image": {
			const url = part.image_url;
			if (typeof url === "string") {
				return part.detail !== undefined
					? {
							type: "image",
							url,
							detail: part.detail as "auto" | "low" | "high",
						}
					: { type: "image", url };
			}
			if (typeof part.file_id === "string")
				return { type: "file", fileId: part.file_id };
			return null;
		}
		case "input_file": {
			const f: CanonicalContentPart = { type: "file" };
			if (typeof part.file_id === "string") f.fileId = part.file_id;
			if (typeof part.file_url === "string") f.fileUrl = part.file_url;
			if (typeof part.file_data === "string") {
				if (/^https:\/\//i.test(part.file_data)) f.fileUrl = part.file_data;
				else f.fileData = part.file_data;
			}
			if (typeof part.filename === "string") f.filename = part.filename;
			if (["auto", "low", "high"].includes(String(part.detail)))
				f.detail = part.detail as "auto" | "low" | "high";
			return f;
		}
		case "input_audio": {
			const input = part.input_audio as
				| { data?: unknown; format?: unknown }
				| undefined;
			if (
				typeof input?.data === "string" &&
				(input.format === "wav" || input.format === "mp3")
			)
				return { type: "audio", data: input.data, format: input.format };
			return null;
		}
		default:
			return null;
	}
}

function mapMessageContent(
	content: unknown,
): string | CanonicalContentPart[] | null {
	if (content === null || content === undefined) return null;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: CanonicalContentPart[] = [];
		for (const p of content) {
			const mapped = mapInputPart(p as Record<string, unknown>);
			if (mapped) parts.push(mapped);
		}
		return parts;
	}
	return null;
}

function mapToolChoice(
	tc: ResponsesRequest["tool_choice"],
): CanonicalToolChoice | undefined {
	if (tc === undefined) return undefined;
	if (typeof tc === "string") {
		return tc === "auto" || tc === "none" || tc === "required" ? tc : "auto";
	}
	const name = (tc as { name?: string }).name;
	if (name) return { name };
	const allowed = tc as {
		type?: string;
		mode?: string;
		tools?: Array<{ type?: string; name?: string }>;
	};
	if (allowed.type === "allowed_tools" && Array.isArray(allowed.tools)) {
		return {
			allowedTools: allowed.tools
				.filter(
					(tool) => tool.type === "function" && typeof tool.name === "string",
				)
				.map((tool) => tool.name!),
			mode: allowed.mode === "required" ? "required" : "auto",
		};
	}
	return "auto";
}

export type ResponseInputItem = Record<string, unknown>;

function extraContent(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return value as Record<string, unknown>;
}

function cloneItem<T>(value: T): T {
	return structuredClone(value);
}

function itemId(item: ResponseInputItem): string | null {
	return typeof item.id === "string" && item.id.length > 0 ? item.id : null;
}

export function normalizeResponseInput(
	input: ResponsesRequest["input"],
): ResponseInputItem[] {
	if (input === undefined) return [];
	if (typeof input === "string") {
		return [
			{
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: input }],
			},
		];
	}
	return input.map((item) => cloneItem(item as ResponseInputItem));
}

export function resolveResponseInputReferences(
	input: ResponseInputItem[],
	referenceItems: ResponseInputItem[] = [],
): ResponseInputItem[] {
	const byId = new Map<string, ResponseInputItem>();
	for (const item of referenceItems) {
		const id = itemId(item);
		if (id) byId.set(id, item);
	}

	const resolved: ResponseInputItem[] = [];
	for (const raw of input) {
		const type = (raw.type as string | undefined) ?? "message";
		if (type === "item_reference") {
			const id = typeof raw.id === "string" ? raw.id : "";
			const found = byId.get(id);
			if (!found) {
				throw new GatewayError({
					class: "bad_request",
					message: `item_reference target not found: ${id}`,
					publicMessage: `Item with id '${id}' not found.`,
					code: "item_reference_not_found",
					param: "input",
				});
			}
			resolved.push(cloneItem(found));
			continue;
		}

		const item = cloneItem(raw);
		resolved.push(item);
		const id = itemId(item);
		if (id) byId.set(id, item);
	}
	return resolved;
}

/**
 * Resolve `item_reference`s in the input, faithful to OpenAI: a reference may point to ANY stored
 * item (when store=true), not only items brought in via `previous_response_id`. `seedReferenceItems`
 * are the already-known items (e.g. from `previous_response_id`); any referenced id not among them is
 * looked up via `lookup` (the state store). Unresolved references still raise `item_reference_not_found`.
 */
export async function expandInputReferences(
	input: ResponseInputItem[],
	seedReferenceItems: ResponseInputItem[],
	lookup: (id: string) => Promise<ResponseInputItem | undefined>,
): Promise<ResponseInputItem[]> {
	const referenceItems = [...seedReferenceItems];
	const known = new Set<string>();
	for (const item of referenceItems) {
		const id = itemId(item);
		if (id) known.add(id);
	}

	const missing = new Set<string>();
	for (const raw of input) {
		if (raw.type !== "item_reference") continue;
		const id = typeof raw.id === "string" ? raw.id : "";
		if (id && !known.has(id)) missing.add(id);
	}

	for (const id of missing) {
		const found = await lookup(id);
		if (found) referenceItems.push(found);
	}
	return resolveResponseInputReferences(input, referenceItems);
}

/** Translates an OpenResponses request to the canonical chat request. */
export function responsesRequestToCanonical(
	req: ResponsesRequest,
): CanonicalChatRequest {
	const messages: CanonicalMessage[] = [];
	let requiresNativeInput = false;
	if (req.instructions)
		messages.push({ role: "system", content: req.instructions });

	if (typeof req.input === "string") {
		messages.push({ role: "user", content: req.input });
	} else if (Array.isArray(req.input)) {
		// OpenAI reasoning state items precede the assistant items they belong to; buffer them and
		// attach to the next assistant-derived message.
		let pendingReasoning: OpenAIReasoningStateItem[] = [];
		const attachPendingReasoning = (message: CanonicalMessage): void => {
			if (pendingReasoning.length === 0) return;
			const existing = openaiReasoningFromProviderFields(
				message.providerFields,
			);
			message.providerFields = providerFieldsWithOpenAIReasoning([
				...(existing ?? []),
				...pendingReasoning,
			]);
			pendingReasoning = [];
		};
		for (const raw of req.input) {
			const item = raw as Record<string, unknown>;
			const type = (item.type as string | undefined) ?? "message";
			switch (type) {
				case "message": {
					const role = (item.role as CanonicalRole) ?? "user";
					const message: CanonicalMessage = {
						role,
						content: mapMessageContent(item.content),
					};
					if (
						Array.isArray(item.content) &&
						Array.isArray(message.content) &&
						message.content.length !== item.content.length
					)
						requiresNativeInput = true;
					if (
						role === "assistant" &&
						(item.phase === "commentary" || item.phase === "final_answer")
					)
						message.phase = item.phase;
					const providerFields = mergeProviderFields(
						message.providerFields,
						extraContent(item.provider_specific_fields),
					);
					if (providerFields !== undefined)
						message.providerFields = providerFields;
					if (role === "assistant") attachPendingReasoning(message);
					messages.push(message);
					break;
				}
				case "function_call": {
					// The gateway embeds the signature in call_id; LiteLLM-style clients carry it on the
					// item id. Accept both, preferring call_id.
					const fromCallId = decodeThoughtSignatureId(item.call_id ?? "");
					const fromItemId = decodeThoughtSignatureId(item.id ?? "");
					const decoded = {
						id: item.call_id !== undefined ? fromCallId.id : fromItemId.id,
						extraContent: fromCallId.extraContent ?? fromItemId.extraContent,
					};
					const extra = mergeProviderExtraContent(
						decoded.extraContent,
						extraContentFromProviderSpecificFields(
							item.provider_specific_fields,
						),
						extraContent(item.extra_content),
					);
					const message: CanonicalMessage = {
						role: "assistant",
						content: null,
						toolCalls: [
							{
								id: decoded.id,
								name: String(item.name ?? ""),
								arguments: String(item.arguments ?? ""),
								...(extra !== undefined ? { extraContent: extra } : {}),
							},
						],
					};
					attachPendingReasoning(message);
					messages.push(message);
					break;
				}
				case "function_call_output": {
					const out = item.output;
					messages.push({
						role: "tool",
						toolCallId: stripThoughtSignatureId(String(item.call_id ?? "")),
						content: typeof out === "string" ? out : mapMessageContent(out),
					});
					break;
				}
				case "reasoning": {
					const mirrored = mirrorReasoningItem(item);
					const encrypted = mirrored.encrypted_content;
					if (typeof encrypted === "string" && encrypted.length > 0) {
						pendingReasoning.push({
							encrypted_content: encrypted,
							...(typeof mirrored.id === "string" && mirrored.id.length > 0
								? { id: mirrored.id }
								: {}),
							...(Array.isArray(mirrored.summary)
								? { summary: structuredClone(mirrored.summary) }
								: {}),
							...(Array.isArray(mirrored.content)
								? { content: structuredClone(mirrored.content) }
								: {}),
						});
					}
					break; // summary-only reasoning state: ignored
				}
				case "item_reference":
					throw new GatewayError({
						class: "bad_request",
						message: "item_reference is not supported yet",
						param: "input",
					});
				default:
					requiresNativeInput = true;
					break;
			}
		}
		// A trailing buffer has no assistant item to anchor to; attach to the last assistant
		// message if any (malformed orderings degrade gracefully instead of erroring).
		if (pendingReasoning.length > 0) {
			const last = [...messages].reverse().find((m) => m.role === "assistant");
			if (last !== undefined) attachPendingReasoning(last);
		}
	}

	const u: CanonicalChatRequest = {
		callType: "chat",
		publicWire: "responses",
		model: req.model,
		messages,
		stream: req.stream,
	};
	const fileParser = fileParserOptionsFromPlugins(req.plugins);
	if (fileParser !== undefined) u.fileParser = fileParser;
	if (req.max_output_tokens !== undefined) u.maxTokens = req.max_output_tokens;
	if (req.temperature !== undefined) u.temperature = req.temperature;
	if (req.top_p !== undefined) u.topP = req.top_p;
	if (req.presence_penalty !== undefined)
		u.presencePenalty = req.presence_penalty;
	if (req.frequency_penalty !== undefined)
		u.frequencyPenalty = req.frequency_penalty;
	if (req.user !== undefined) u.user = req.user;
	if (req.parallel_tool_calls !== undefined)
		u.parallelToolCalls = req.parallel_tool_calls;
	const responseFormat = req.text?.format;
	if (responseFormat !== undefined) {
		if (responseFormat.type === "json_schema") {
			const format: CanonicalResponseFormat = {
				type: "json_schema",
				name: responseFormat.name,
				schema: responseFormat.schema,
			};
			if (responseFormat.description !== undefined)
				format.description = responseFormat.description;
			if (responseFormat.strict != null) format.strict = responseFormat.strict;
			u.responseFormat = format;
		} else {
			u.responseFormat = { type: responseFormat.type };
		}
	}
	if (req.reasoning !== undefined) {
		const effort = req.reasoning.effort;
		const summary = req.reasoning.summary;
		if (effort !== undefined) {
			if (!isReasoningEffort(effort)) {
				throw new GatewayError({
					class: "bad_request",
					message: `Unsupported reasoning effort: ${String(effort)}`,
					param: "reasoning.effort",
				});
			}
		}
		if (
			summary !== undefined &&
			!["auto", "none", "concise", "detailed"].includes(String(summary))
		) {
			throw new GatewayError({
				class: "bad_request",
				message: `Unsupported reasoning summary: ${String(summary)}`,
				param: "reasoning.summary",
			});
		}
		const reasoningSummary = summaryForEffort(
			isReasoningEffort(effort) ? effort : undefined,
			summary as ReasoningSummary | undefined,
		);
		if (effort !== undefined || reasoningSummary !== undefined) {
			u.reasoning = {
				...(isReasoningEffort(effort) ? { effort } : {}),
				...(reasoningSummary !== undefined
					? { summary: reasoningSummary }
					: {}),
			};
		}
	}
	if (req.extra_body !== undefined) {
		assertNoManagedExtraBodyKeys(
			req.extra_body,
			RESPONSES_EXTRA_BODY_MANAGED_KEYS,
		);
		u.extraBody = req.extra_body;
	}
	const textTransport =
		req.text === undefined
			? undefined
			: Object.fromEntries(
					Object.entries(req.text).filter(([key]) => key !== "format"),
				);
	if (
		req.include !== undefined ||
		req.metadata !== undefined ||
		(textTransport !== undefined && Object.keys(textTransport).length > 0) ||
		req.reasoning !== undefined ||
		req.stream_options !== undefined ||
		req.service_tier !== undefined ||
		req.safety_identifier !== undefined ||
		req.prompt_cache_key !== undefined ||
		req.top_logprobs !== undefined ||
		req.max_tool_calls !== undefined ||
		req.user !== undefined ||
		req.truncation !== undefined ||
		req.context_management !== undefined ||
		requiresNativeInput
	) {
		const reasoningTransport =
			req.reasoning === undefined
				? undefined
				: Object.fromEntries(
						Object.entries(req.reasoning).filter(
							([key]) => key !== "effort" && key !== "summary",
						),
					);
		u.responsesTransport = {
			...(req.include !== undefined ? { include: req.include } : {}),
			...(req.metadata !== undefined ? { metadata: req.metadata } : {}),
			...(textTransport !== undefined && Object.keys(textTransport).length > 0
				? { text: textTransport }
				: {}),
			...(reasoningTransport !== undefined &&
			Object.keys(reasoningTransport).length > 0
				? { reasoning: reasoningTransport }
				: {}),
			...(req.stream_options !== undefined
				? { streamOptions: req.stream_options }
				: {}),
			...(req.service_tier !== undefined
				? { serviceTier: req.service_tier }
				: {}),
			...(req.safety_identifier !== undefined
				? { safetyIdentifier: req.safety_identifier }
				: {}),
			...(req.prompt_cache_key !== undefined
				? { promptCacheKey: req.prompt_cache_key }
				: {}),
			...(req.top_logprobs !== undefined
				? { topLogprobs: req.top_logprobs }
				: {}),
			...(req.max_tool_calls !== undefined
				? { maxToolCalls: req.max_tool_calls }
				: {}),
			...(req.user !== undefined ? { user: req.user } : {}),
			...(req.truncation !== undefined ? { truncation: req.truncation } : {}),
			...(req.context_management !== undefined
				? { contextManagement: req.context_management }
				: {}),
			...(requiresNativeInput && Array.isArray(req.input)
				? { rawInput: structuredClone(req.input) }
				: {}),
		};
	}
	if (req.prompt_cache_key !== undefined)
		u.promptCacheKey = req.prompt_cache_key;
	if (
		req.service_tier !== undefined ||
		req.safety_identifier !== undefined ||
		req.top_logprobs !== undefined ||
		req.max_tool_calls !== undefined ||
		req.user !== undefined ||
		req.context_management !== undefined ||
		(req.truncation !== undefined && req.truncation !== "disabled") ||
		(textTransport !== undefined && Object.keys(textTransport).length > 0)
	)
		u.requiresNativeWire = true;

	if (Array.isArray(req.tools)) {
		const tools = [];
		let requiresNativeTools = false;
		for (const t of req.tools) {
			const tool = t as Record<string, unknown>;
			if (tool.type === "function" && typeof tool.name === "string") {
				const entry: NonNullable<CanonicalChatRequest["tools"]>[number] = {
					name: tool.name,
				};
				if (typeof tool.description === "string")
					entry.description = tool.description;
				if (tool.parameters && typeof tool.parameters === "object") {
					entry.parameters = tool.parameters as Record<string, unknown>;
				}
				if (typeof tool.strict === "boolean") entry.strict = tool.strict;
				tools.push(entry);
			} else requiresNativeTools = true;
		}
		if (tools.length > 0) u.tools = tools;
		if (requiresNativeTools) {
			u.requiresNativeWire = true;
			u.responsesTransport = {
				...(u.responsesTransport ?? {}),
				rawTools: structuredClone(req.tools),
			};
		}
	}
	if (requiresNativeInput) u.requiresNativeWire = true;
	const tc = mapToolChoice(req.tool_choice);
	if (tc !== undefined) u.toolChoice = tc;

	return u;
}

/* ---------------------------------------------- canonical -> response */

export interface RenderOptions {
	/** Original request (for echoing fields: instructions, tools, etc.). */
	req: ResponsesRequest;
	/** Public model selected by the router. */
	publicModel: string;
}

export function toResponsesUsage(usage: Usage): Record<string, unknown> {
	return {
		input_tokens: usage.promptTokens,
		input_tokens_details: { cached_tokens: usage.cacheReadTokens ?? 0 },
		output_tokens: usage.completionTokens,
		output_tokens_details: { reasoning_tokens: usage.reasoningTokens ?? 0 },
		total_tokens: usage.totalTokens,
	};
}

function statusFor(finish: CanonicalFinishReason | null): {
	status: string;
	incomplete: Record<string, unknown> | null;
} {
	if (finish === "length")
		return {
			status: "incomplete",
			incomplete: { reason: "max_output_tokens" },
		};
	if (finish === "content_filter")
		return { status: "incomplete", incomplete: { reason: "content_filter" } };
	return { status: "completed", incomplete: null };
}

function messageItem(
	content: string,
	id: string,
	phase?: "commentary" | "final_answer",
	providerFields?: Record<string, unknown>,
): Record<string, unknown> {
	return {
		type: "message",
		id,
		status: "completed",
		role: "assistant",
		...(phase !== undefined ? { phase } : {}),
		...(providerFields !== undefined
			? { provider_specific_fields: providerFields }
			: {}),
		content: [{ type: "output_text", text: content, annotations: [] }],
	};
}

function reasoningItem(summary: string, id: string): Record<string, unknown> {
	return mirrorReasoningItem({
		type: "reasoning",
		id,
		summary: [{ type: "summary_text", text: summary }],
	});
}

/**
 * Renders OpenAI reasoning state (encrypted_content) as native reasoning output items so
 * clients that replay output items round-trip it. Emitted regardless of the client's `include`
 * (deliberate deviation from OpenAI: it is what makes default store:false replay flows work).
 * A visible summary is folded into the first state item lacking one.
 */
function reasoningStateItems(
	items: OpenAIReasoningStateItem[],
	summary: string | null | undefined,
): Record<string, unknown>[] {
	let summaryLeft = typeof summary === "string" && summary.length > 0;
	return items.map((item) => {
		const hasOwnSummary =
			(Array.isArray(item.summary) && item.summary.length > 0) ||
			(Array.isArray(item.content) && item.content.length > 0);
		const useSummary = summaryLeft && !hasOwnSummary;
		if (useSummary) summaryLeft = false;
		return mirrorReasoningItem({
			type: "reasoning",
			id: item.id ?? `rs_${randomUUID()}`,
			summary: useSummary
				? [{ type: "summary_text", text: summary }]
				: (item.summary ?? []),
			...(item.content !== undefined ? { content: item.content } : {}),
			encrypted_content: item.encrypted_content,
		});
	});
}

function functionCallItem(
	tc: {
		id: string;
		name: string;
		arguments: string;
		extraContent?: Record<string, unknown>;
	},
	id: string,
): Record<string, unknown> {
	const providerSpecificFields = providerSpecificFieldsFromExtraContent(
		tc.extraContent,
	);
	return {
		type: "function_call",
		id,
		// The thought signature rides inside the public call_id (LiteLLM-compatible): clients echo
		// call_id verbatim even when they drop extra_content/provider_specific_fields.
		call_id: encodeThoughtSignatureId(tc.id, tc.extraContent),
		name: tc.name,
		arguments: tc.arguments,
		status: "completed",
		...(tc.extraContent !== undefined
			? { extra_content: tc.extraContent }
			: {}),
		...(providerSpecificFields !== undefined
			? { provider_specific_fields: providerSpecificFields }
			: {}),
	};
}

function outputProviderSpecificFields(
	output: Record<string, unknown>[],
): Record<string, unknown> | undefined {
	const thoughtSignatures: string[] = [];
	for (const item of output) {
		const fields = item.provider_specific_fields;
		if (fields === null || typeof fields !== "object" || Array.isArray(fields))
			continue;
		const signature = (fields as Record<string, unknown>).thought_signature;
		if (typeof signature === "string" && signature.length > 0)
			thoughtSignatures.push(signature);
	}
	return thoughtSignatures.length > 0
		? { thought_signatures: thoughtSignatures }
		: undefined;
}

/** Builds the OpenResponses `response` object. */
function buildResponse(
	opts: RenderOptions,
	parts: {
		id: string;
		createdAt: number;
		status: string;
		incomplete: Record<string, unknown> | null;
		output: Record<string, unknown>[];
		usage: Usage | null;
		outputText: string;
	},
): Record<string, unknown> {
	const { req } = opts;
	const providerSpecificFields = outputProviderSpecificFields(parts.output);
	return {
		id: parts.id,
		object: "response",
		created_at: parts.createdAt,
		completed_at:
			parts.status === "in_progress" ? null : Math.floor(Date.now() / 1000),
		status: parts.status,
		background: req.background ?? false,
		error: null,
		incomplete_details: parts.incomplete,
		instructions: req.instructions ?? null,
		max_output_tokens: req.max_output_tokens ?? null,
		max_tool_calls: req.max_tool_calls ?? null,
		model: opts.publicModel,
		output: parts.output,
		output_text: parts.outputText,
		parallel_tool_calls: req.parallel_tool_calls ?? true,
		previous_response_id: req.previous_response_id ?? null,
		reasoning: reasoningEcho(req),
		store: req.store === true,
		temperature: req.temperature ?? 1,
		text: req.text ?? { format: { type: "text" } },
		tool_choice: req.tool_choice ?? "auto",
		tools: req.tools ?? [],
		top_p: req.top_p ?? 1,
		presence_penalty: req.presence_penalty ?? 0,
		frequency_penalty: req.frequency_penalty ?? 0,
		top_logprobs: req.top_logprobs ?? 0,
		truncation: req.truncation ?? "disabled",
		usage: parts.usage ? toResponsesUsage(parts.usage) : null,
		metadata: req.metadata ?? {},
		service_tier: req.service_tier ?? "default",
		safety_identifier: req.safety_identifier ?? null,
		prompt_cache_key: req.prompt_cache_key ?? null,
		...(providerSpecificFields !== undefined
			? { provider_specific_fields: providerSpecificFields }
			: {}),
	};
}

function reasoningEcho(req: ResponsesRequest): Record<string, unknown> {
	const effort = req.reasoning?.effort;
	const summary = summaryForEffort(
		isReasoningEffort(effort) ? effort : undefined,
		req.reasoning?.summary as ReasoningSummary | undefined,
	);
	return {
		effort: effort ?? null,
		summary: summary ?? null,
	};
}

/** Canonical result (non-stream) -> OpenResponses `response` object. */
export function canonicalToResponsesResponse(
	resp: CanonicalChatResponse,
	opts: RenderOptions,
): Record<string, unknown> {
	const choice = resp.choices[0];
	const content = choice?.message.content ?? "";
	const { status, incomplete } = statusFor(choice?.finishReason ?? null);

	const output: Record<string, unknown>[] = [];
	const reasoningState = openaiReasoningFromProviderFields(
		choice?.message.providerFields,
	);
	const nativeOutput = responsesOutputFromProviderFields(
		choice?.message.providerFields,
	);
	if (nativeOutput !== undefined)
		output.push(...mirrorReasoningOutput(nativeOutput));
	else {
		if (reasoningState !== undefined) {
			output.push(
				...reasoningStateItems(reasoningState, choice?.message.reasoning),
			);
		} else if (choice?.message.reasoning) {
			output.push(
				reasoningItem(choice.message.reasoning, `rs_${randomUUID()}`),
			);
		}
		if (content)
			output.push(
				messageItem(
					content,
					`msg_${randomUUID()}`,
					choice?.message.phase,
					withoutOpenAIResponsesReasoningState(choice?.message.providerFields),
				),
			);
		for (const tc of choice?.message.toolCalls ?? []) {
			output.push(functionCallItem(tc, `fc_${randomUUID()}`));
		}
	}

	return buildResponse(opts, {
		id: `resp_${randomUUID()}`,
		createdAt: resp.created,
		status,
		incomplete,
		output,
		usage: resp.usage,
		outputText: content,
	});
}

/* ---------------------------------------------- canonical stream -> SSE events */

function sse(
	type: string,
	seq: number,
	extra: Record<string, unknown>,
): SSEEvent {
	return {
		event: type,
		data: JSON.stringify({ type, sequence_number: seq, ...extra }),
	};
}

function eventIndex(value: unknown): number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
		? value
		: 0;
}

function summaryPartKey(data: Record<string, unknown>): string {
	return `${String(data.item_id ?? "")}:${String(data.output_index ?? "")}:${eventIndex(data.summary_index ?? data.content_index)}`;
}

function reasoningTextMirrors(
	type: string,
	data: Record<string, unknown>,
): Array<{ type: string; data: Record<string, unknown> }> {
	if (type === "response.reasoning_summary_text.delta") {
		const twin = structuredClone(data);
		delete twin.summary_index;
		twin.content_index = eventIndex(data.summary_index ?? data.content_index);
		return [{ type: "response.reasoning_text.delta", data: twin }];
	}
	if (type === "response.reasoning_text.delta") {
		const twin = structuredClone(data);
		delete twin.content_index;
		twin.summary_index = eventIndex(data.content_index ?? data.summary_index);
		return [{ type: "response.reasoning_summary_text.delta", data: twin }];
	}
	if (
		type === "response.reasoning_summary.delta" ||
		type === "response.reasoning.delta"
	) {
		const content = structuredClone(data);
		delete content.summary_index;
		content.content_index = eventIndex(
			data.content_index ?? data.summary_index,
		);
		const summary = structuredClone(data);
		delete summary.content_index;
		summary.summary_index = eventIndex(
			data.summary_index ?? data.content_index,
		);
		return [
			{ type: "response.reasoning_text.delta", data: content },
			{ type: "response.reasoning_summary_text.delta", data: summary },
		];
	}
	if (type === "response.reasoning_summary_text.done") {
		const twin = structuredClone(data);
		delete twin.summary_index;
		twin.content_index = eventIndex(data.summary_index ?? data.content_index);
		return [{ type: "response.reasoning_text.done", data: twin }];
	}
	if (type === "response.reasoning_text.done") {
		const twin = structuredClone(data);
		delete twin.content_index;
		twin.summary_index = eventIndex(data.content_index ?? data.summary_index);
		return [{ type: "response.reasoning_summary_text.done", data: twin }];
	}
	if (
		type === "response.reasoning_summary.done" ||
		type === "response.reasoning.done"
	) {
		const content = structuredClone(data);
		delete content.summary_index;
		content.content_index = eventIndex(
			data.content_index ?? data.summary_index,
		);
		const summary = structuredClone(data);
		delete summary.content_index;
		summary.summary_index = eventIndex(
			data.summary_index ?? data.content_index,
		);
		return [
			{ type: "response.reasoning_text.done", data: content },
			{ type: "response.reasoning_summary_text.done", data: summary },
		];
	}
	return [];
}

/**
 * Converts the canonical chunk stream into the OpenResponses SSE event sequence.
 * Native Responses item events retain provider order and identity. Other provider streams are
 * synthesized from canonical text, reasoning, and tool-call deltas.
 */
export async function* canonicalChunksToResponsesEvents(
	chunks: AsyncIterable<CanonicalChatStreamChunk>,
	opts: RenderOptions,
): AsyncGenerator<SSEEvent> {
	const responseId = `resp_${randomUUID()}`;
	const createdAt = Math.floor(Date.now() / 1000);
	let seq = 0;
	const next = () => seq++;

	let content = "";
	let reasoning = "";
	let usage: Usage | null = null;
	let finish: CanonicalFinishReason | null = null;
	const toolCalls = new Map<
		number,
		{
			id: string;
			name: string;
			arguments: string;
			extraContent?: Record<string, unknown>;
		}
	>();

	const output: Record<string, unknown>[] = [];
	let nextOutputIndex = 0;

	let messageStarted = false;
	let msgIndex = 0;
	const msgId = `msg_${randomUUID()}`;

	// Reasoning streams as its own output item, before the message (as in the
	// non-stream render). `reasoningOpen` tracks an item awaiting its `.done` events.
	let reasoningOpen = false;
	let reasoningStreamed = false;
	let rsIndex = 0;
	let rsId = `rs_${randomUUID()}`;

	// OpenAI encrypted reasoning state accumulated across deltas. State-only items are emitted at
	// their arrival point so their native position relative to messages and tool calls is preserved;
	// state belonging to an open visible summary is held only until that same item can be completed.
	const reasoningState: OpenAIReasoningStateItem[] = [];
	const renderedReasoningState = new Set<OpenAIReasoningStateItem>();
	const nativeOutput: Record<string, unknown>[] = [];
	const nativeStreamOutputItems = new Map<number, Record<string, unknown>>();
	let nativeStreamOutput: Record<string, unknown>[] | undefined;
	let nativeResponsesStream = false;
	let messageProviderFields: Record<string, unknown> | undefined;
	const nativeSummaryPartsOpen = new Set<string>();
	const nativeSummaryPartsDone = new Set<string>();
	const appendReasoningState = (
		fields: Record<string, unknown> | undefined,
	): OpenAIReasoningStateItem[] => {
		const appended: OpenAIReasoningStateItem[] = [];
		for (const item of openaiReasoningFromProviderFields(fields) ?? []) {
			if (
				item.id !== undefined &&
				reasoningState.some((existing) => existing.id === item.id)
			)
				continue;
			reasoningState.push(item);
			appended.push(item);
		}
		return appended;
	};

	const reasoningStateEvents = (
		state: OpenAIReasoningStateItem,
	): SSEEvent[] => {
		const item = reasoningStateItems([state], null)[0]!;
		const outputIndex = nextOutputIndex++;
		renderedReasoningState.add(state);
		output.push(item);
		return [
			sse("response.output_item.added", next(), {
				output_index: outputIndex,
				item,
			}),
			sse("response.output_item.done", next(), {
				output_index: outputIndex,
				item,
			}),
		];
	};

	const reasoningSummaryDone = (): SSEEvent[] => {
		reasoningOpen = false;
		const matchingState = reasoningState.find((item) => item.id === rsId);
		const item =
			matchingState === undefined
				? reasoningItem(reasoning, rsId)
				: reasoningStateItems([matchingState], reasoning)[0]!;
		if (matchingState !== undefined) renderedReasoningState.add(matchingState);
		output.push(item);
		return [
			sse("response.reasoning_summary_text.done", next(), {
				item_id: rsId,
				output_index: rsIndex,
				summary_index: 0,
				text: reasoning,
			}),
			sse("response.reasoning_text.done", next(), {
				item_id: rsId,
				output_index: rsIndex,
				content_index: 0,
				text: reasoning,
			}),
			sse("response.reasoning_summary_part.done", next(), {
				item_id: rsId,
				output_index: rsIndex,
				summary_index: 0,
				part: { type: "summary_text", text: reasoning },
			}),
			sse("response.output_item.done", next(), {
				output_index: rsIndex,
				item,
			}),
		];
	};

	const baseResponse = (status: string) =>
		buildResponse(opts, {
			id: responseId,
			createdAt,
			status,
			incomplete: null,
			output: [],
			usage: null,
			outputText: "",
		});

	yield sse("response.created", next(), {
		response: baseResponse("in_progress"),
	});
	yield sse("response.in_progress", next(), {
		response: baseResponse("in_progress"),
	});

	for await (const chunk of chunks) {
		if (chunk.usage) usage = chunk.usage;
		const choice = chunk.choices[0];
		if (!choice) continue;
		if (choice.finishReason) finish = choice.finishReason;

		const delta = choice.delta;
		const streamOutput = openaiResponsesStreamOutputFromProviderFields(
			delta.providerFields,
		);
		if (streamOutput !== undefined)
			nativeStreamOutput = mirrorReasoningOutput(streamOutput);
		const streamEvent = openaiResponsesStreamEventFromProviderFields(
			delta.providerFields,
		);
		if (streamEvent !== undefined) {
			nativeResponsesStream = true;
			const streamData = mirrorReasoningEventData(streamEvent.data);
			const partKey = summaryPartKey(streamData);
			if (streamEvent.type === "response.reasoning_summary_part.added") {
				if (nativeSummaryPartsOpen.has(partKey)) continue;
				nativeSummaryPartsOpen.add(partKey);
			}
			if (streamEvent.type === "response.reasoning_summary_part.done") {
				if (nativeSummaryPartsDone.has(partKey)) continue;
				nativeSummaryPartsDone.add(partKey);
			}
			const mirrors = reasoningTextMirrors(streamEvent.type, streamData);
			const textEvents = [
				{ type: streamEvent.type, data: streamData },
				...mirrors,
			];
			const hasSummaryText = textEvents.some((event) =>
				event.type.startsWith("response.reasoning_summary_text."),
			);
			if (hasSummaryText && !nativeSummaryPartsOpen.has(partKey)) {
				nativeSummaryPartsOpen.add(partKey);
				yield sse("response.reasoning_summary_part.added", next(), {
					item_id: streamData.item_id,
					output_index: eventIndex(streamData.output_index),
					summary_index: eventIndex(
						streamData.content_index ?? streamData.summary_index,
					),
					part: { type: "summary_text", text: "" },
				});
			}
			yield sse(streamEvent.type, next(), streamData);
			for (const mirror of mirrors) yield sse(mirror.type, next(), mirror.data);
			if (
				textEvents.some(
					(event) => event.type === "response.reasoning_summary_text.done",
				) &&
				!nativeSummaryPartsDone.has(partKey)
			) {
				nativeSummaryPartsDone.add(partKey);
				yield sse("response.reasoning_summary_part.done", next(), {
					item_id: streamData.item_id,
					output_index: eventIndex(streamData.output_index),
					summary_index: eventIndex(
						streamData.content_index ?? streamData.summary_index,
					),
					part: {
						type: "summary_text",
						text: typeof streamData.text === "string" ? streamData.text : "",
					},
				});
			}
			if (streamEvent.type === "response.output_item.done") {
				const outputIndex = streamData.output_index;
				const item = streamData.item;
				if (
					typeof outputIndex === "number" &&
					Number.isInteger(outputIndex) &&
					outputIndex >= 0 &&
					item !== null &&
					typeof item === "object" &&
					!Array.isArray(item)
				)
					nativeStreamOutputItems.set(
						outputIndex,
						structuredClone(item as Record<string, unknown>),
					);
			}
			if (delta.content) content += delta.content;
			if (delta.reasoning) reasoning += delta.reasoning;
			continue;
		}
		// A native Responses terminal chunk carries the authoritative output but is rendered with a
		// gateway-owned response envelope below. Do not fall back to heuristic item synthesis.
		if (nativeResponsesStream) continue;
		if (delta.reasoning) {
			if (!reasoningStreamed && !messageStarted) {
				rsId =
					openaiReasoningItemIdFromProviderFields(delta.providerFields) ?? rsId;
				reasoningStreamed = true;
				reasoningOpen = true;
				rsIndex = nextOutputIndex++;
				yield sse("response.output_item.added", next(), {
					output_index: rsIndex,
					item: { type: "reasoning", id: rsId, summary: [], content: [] },
				});
				yield sse("response.reasoning_summary_part.added", next(), {
					item_id: rsId,
					output_index: rsIndex,
					summary_index: 0,
					part: { type: "summary_text", text: "" },
				});
			}
			reasoning += delta.reasoning;
			if (reasoningOpen) {
				yield sse("response.reasoning_summary_text.delta", next(), {
					item_id: rsId,
					output_index: rsIndex,
					summary_index: 0,
					delta: delta.reasoning,
				});
				yield sse("response.reasoning_text.delta", next(), {
					item_id: rsId,
					output_index: rsIndex,
					content_index: 0,
					delta: delta.reasoning,
				});
			}
		}
		if (delta.providerFields !== undefined) {
			for (const state of appendReasoningState(delta.providerFields)) {
				const belongsToOpenSummary =
					reasoningOpen && state.id !== undefined && state.id === rsId;
				if (!belongsToOpenSummary) yield* reasoningStateEvents(state);
			}
			messageProviderFields = mergeProviderFields(
				messageProviderFields,
				withoutOpenAIResponsesReasoningState(delta.providerFields),
			);
		}
		for (const item of mirrorReasoningOutput(
			responsesOutputFromProviderFields(delta.providerFields) ?? [],
		))
			nativeOutput.push(item);
		if (delta.content) {
			if (!messageStarted) {
				if (reasoningOpen) yield* reasoningSummaryDone();
				messageStarted = true;
				msgIndex = nextOutputIndex++;
				yield sse("response.output_item.added", next(), {
					output_index: msgIndex,
					item: {
						type: "message",
						id: msgId,
						status: "in_progress",
						role: "assistant",
						content: [],
					},
				});
				yield sse("response.content_part.added", next(), {
					item_id: msgId,
					output_index: msgIndex,
					content_index: 0,
					part: { type: "output_text", text: "", annotations: [] },
				});
			}
			content += delta.content;
			yield sse("response.output_text.delta", next(), {
				item_id: msgId,
				output_index: msgIndex,
				content_index: 0,
				delta: delta.content,
			});
		}

		for (const tc of delta.toolCalls ?? []) {
			const cur = toolCalls.get(tc.index) ?? {
				id: "",
				name: "",
				arguments: "",
			};
			if (tc.id) cur.id = tc.id;
			if (tc.name) cur.name = tc.name;
			if (tc.arguments) cur.arguments += tc.arguments;
			if (tc.extraContent !== undefined) cur.extraContent = tc.extraContent;
			toolCalls.set(tc.index, cur);
		}
	}

	if (nativeResponsesStream) {
		const orderedOutput =
			nativeStreamOutput ??
			[...nativeStreamOutputItems.entries()]
				.sort(([left], [right]) => left - right)
				.map(([, item]) => item);
		let outputText = "";
		for (const item of orderedOutput) {
			if (item.type !== "message" || !Array.isArray(item.content)) continue;
			for (const part of item.content) {
				if (
					part !== null &&
					typeof part === "object" &&
					!Array.isArray(part) &&
					(part as Record<string, unknown>).type === "output_text" &&
					typeof (part as Record<string, unknown>).text === "string"
				)
					outputText += (part as Record<string, unknown>).text as string;
			}
		}
		const { status, incomplete } = statusFor(finish);
		const finalResponse = buildResponse(opts, {
			id: responseId,
			createdAt,
			status,
			incomplete,
			output: orderedOutput,
			usage,
			outputText: outputText || content,
		});
		yield sse(
			status === "incomplete" ? "response.incomplete" : "response.completed",
			next(),
			{ response: finalResponse },
		);
		return;
	}

	if (reasoningOpen) yield* reasoningSummaryDone();

	if (messageStarted) {
		yield sse("response.output_text.done", next(), {
			item_id: msgId,
			output_index: msgIndex,
			content_index: 0,
			text: content,
		});
		yield sse("response.content_part.done", next(), {
			item_id: msgId,
			output_index: msgIndex,
			content_index: 0,
			part: { type: "output_text", text: content, annotations: [] },
		});
		const item = messageItem(content, msgId, undefined, messageProviderFields);
		output.push(item);
		yield sse("response.output_item.done", next(), {
			output_index: msgIndex,
			item,
		});
	}

	// Reasoning that arrived after the message opened (unusual interleave):
	// emit it as a complete trailing item so nothing is dropped.
	if (reasoning && !reasoningStreamed) {
		rsIndex = nextOutputIndex++;
		yield sse("response.output_item.added", next(), {
			output_index: rsIndex,
			item: { type: "reasoning", id: rsId, summary: [], content: [] },
		});
		yield sse("response.reasoning_summary_part.added", next(), {
			item_id: rsId,
			output_index: rsIndex,
			summary_index: 0,
			part: { type: "summary_text", text: "" },
		});
		yield sse("response.reasoning_summary_text.delta", next(), {
			item_id: rsId,
			output_index: rsIndex,
			summary_index: 0,
			delta: reasoning,
		});
		yield sse("response.reasoning_text.delta", next(), {
			item_id: rsId,
			output_index: rsIndex,
			content_index: 0,
			delta: reasoning,
		});
		reasoningOpen = true;
		yield* reasoningSummaryDone();
	}

	// Defensive terminal fallback for providers that expose encrypted state only in the completed
	// response. Normal streamed state has already been emitted in native arrival order above.
	for (const stateItem of reasoningStateItems(
		reasoningState.filter((item) => !renderedReasoningState.has(item)),
		null,
	)) {
		const stateIndex = nextOutputIndex++;
		yield sse("response.output_item.added", next(), {
			output_index: stateIndex,
			item: stateItem,
		});
		yield sse("response.output_item.done", next(), {
			output_index: stateIndex,
			item: stateItem,
		});
		output.push(stateItem);
	}

	for (const item of nativeOutput) {
		const outputIndex = nextOutputIndex++;
		yield sse("response.output_item.added", next(), {
			output_index: outputIndex,
			item,
		});
		yield sse("response.output_item.done", next(), {
			output_index: outputIndex,
			item,
		});
		output.push(item);
	}

	for (const tc of toolCalls.values()) {
		const fcId = `fc_${randomUUID()}`;
		const item = functionCallItem(tc, fcId);
		const fcIndex = nextOutputIndex++;
		yield sse("response.output_item.added", next(), {
			output_index: fcIndex,
			item: { ...item, status: "in_progress", arguments: "" },
		});
		yield sse("response.function_call_arguments.delta", next(), {
			item_id: fcId,
			output_index: fcIndex,
			delta: tc.arguments,
		});
		yield sse("response.function_call_arguments.done", next(), {
			item_id: fcId,
			output_index: fcIndex,
			arguments: tc.arguments,
		});
		yield sse("response.output_item.done", next(), {
			output_index: fcIndex,
			item,
		});
		output.push(item);
	}

	const { status, incomplete } = statusFor(finish);
	const finalResponse = buildResponse(opts, {
		id: responseId,
		createdAt,
		status,
		incomplete,
		output,
		usage,
		outputText: content,
	});
	yield sse(
		status === "incomplete" ? "response.incomplete" : "response.completed",
		next(),
		{
			response: finalResponse,
		},
	);
}
