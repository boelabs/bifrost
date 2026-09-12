/**
 * Provider-specific opaque state that must round-trip through clients.
 *
 * Two carriers exist, both stateless:
 *
 * - Tool-call-bound state (Gemini thought signatures): embedded in the public tool call id as
 *   `<id>__thought__<signature>` (LiteLLM-compatible), so any client that echoes tool call ids
 *   verbatim round-trips it without understanding any extra field. Also mirrored as
 *   `provider_specific_fields` / `extra_content` on the rendered tool call for rich clients.
 * - Message-bound state (OpenAI encrypted reasoning items): carried as a provider-namespaced
 *   record on the canonical assistant message (`providerFields.openai.reasoning`), rendered as
 *   native `reasoning` output items on /v1/responses and as message-level
 *   `provider_specific_fields` on /v1/chat/completions.
 *
 * Encoding/decoding happens exclusively in the contracts layer; canonical ids are always clean
 * and adapters stay signature-agnostic.
 */

/**
 * Separator used by LiteLLM to embed a Gemini thought signature in a tool call id.
 * Signatures are standard base64 (`A-Za-z0-9+/=`), which cannot contain `_`, so the separator
 * can never occur inside a signature and splitting on its first occurrence is unambiguous.
 */
export const LITELLM_THOUGHT_SEPARATOR = "__thought__";

function recordValue(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return value as Record<string, unknown>;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
	return structuredClone(value);
}

function mergeRecords(
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> {
	const merged = cloneRecord(base);
	for (const [key, value] of Object.entries(override)) {
		const current = recordValue(merged[key]);
		const next = recordValue(value);
		merged[key] =
			current !== undefined && next !== undefined
				? mergeRecords(current, next)
				: structuredClone(value);
	}
	return merged;
}

/** Deep merge of provider-namespaced records; later values win per key. */
export function mergeProviderExtraContent(
	...values: Array<Record<string, unknown> | undefined>
): Record<string, unknown> | undefined {
	let merged: Record<string, unknown> | undefined;
	for (const value of values) {
		if (value === undefined) continue;
		merged =
			merged === undefined ? cloneRecord(value) : mergeRecords(merged, value);
	}
	return merged;
}

/** Alias: message/choice-level providerFields records merge with the same semantics. */
export const mergeProviderFields = mergeProviderExtraContent;

/** Native Responses output items retained when the canonical subset cannot represent them. */
export function responsesOutputFromProviderFields(
	fields: Record<string, unknown> | undefined,
): Record<string, unknown>[] | undefined {
	const openai = recordValue(fields?.openai);
	const output = openai?.response_output;
	return Array.isArray(output)
		? output
				.filter(
					(item): item is Record<string, unknown> =>
						item !== null && typeof item === "object" && !Array.isArray(item),
				)
				.map((item) => structuredClone(item))
		: undefined;
}

export function providerFieldsWithResponsesOutput(
	output: Record<string, unknown>[],
): Record<string, unknown> {
	return { openai: { response_output: structuredClone(output) } };
}

export interface OpenAIResponsesStreamEvent {
	type: string;
	data: Record<string, unknown>;
}

/**
 * Carries an item-scoped Responses event through the canonical stream without making the event part
 * of the provider-agnostic vocabulary. Response lifecycle events remain gateway-owned.
 */
export function providerFieldsWithOpenAIResponsesStreamEvent(
	type: string,
	payload: Record<string, unknown>,
): Record<string, unknown> {
	const data = structuredClone(payload);
	delete data.type;
	delete data.sequence_number;
	return { openai: { responses: { stream_event: { type, data } } } };
}

export function openaiResponsesStreamEventFromProviderFields(
	fields: Record<string, unknown> | undefined,
): OpenAIResponsesStreamEvent | undefined {
	const openai = recordValue(fields?.openai);
	const responses = recordValue(openai?.responses);
	const event = recordValue(responses?.stream_event);
	const data = recordValue(event?.data);
	return typeof event?.type === "string" && data !== undefined
		? { type: event.type, data: structuredClone(data) }
		: undefined;
}

/** Authoritative terminal output used to verify/recover a native Responses stream. */
export function providerFieldsWithOpenAIResponsesStreamOutput(
	output: Record<string, unknown>[],
): Record<string, unknown> {
	return {
		openai: { responses: { stream_output: structuredClone(output) } },
	};
}

export function openaiResponsesStreamOutputFromProviderFields(
	fields: Record<string, unknown> | undefined,
): Record<string, unknown>[] | undefined {
	const openai = recordValue(fields?.openai);
	const responses = recordValue(openai?.responses);
	const output = responses?.stream_output;
	return Array.isArray(output)
		? output
				.filter(
					(item): item is Record<string, unknown> =>
						item !== null && typeof item === "object" && !Array.isArray(item),
				)
				.map((item) => structuredClone(item))
		: undefined;
}

export type AnthropicThinkingBlock =
	| { type: "thinking"; thinking: string; signature: string }
	| { type: "redacted_thinking"; data: string };

function isAnthropicThinkingBlock(
	value: unknown,
): value is AnthropicThinkingBlock {
	const block = recordValue(value);
	if (block?.type === "thinking")
		return (
			typeof block.thinking === "string" && typeof block.signature === "string"
		);
	return block?.type === "redacted_thinking" && typeof block.data === "string";
}

export function anthropicThinkingFromProviderFields(
	fields: Record<string, unknown> | undefined,
): AnthropicThinkingBlock[] | undefined {
	const anthropic = recordValue(fields?.anthropic);
	const blocks = anthropic?.thinking_blocks;
	return Array.isArray(blocks)
		? blocks
				.filter(isAnthropicThinkingBlock)
				.map((block) => structuredClone(block))
		: undefined;
}

export function providerFieldsWithAnthropicThinking(
	blocks: AnthropicThinkingBlock[],
): Record<string, unknown> {
	return { anthropic: { thinking_blocks: structuredClone(blocks) } };
}

export function googleContentPartsFromProviderFields(
	fields: Record<string, unknown> | undefined,
): Record<string, unknown>[] | undefined {
	const google = recordValue(fields?.google);
	const parts = google?.content_parts;
	return Array.isArray(parts)
		? parts
				.filter(
					(part): part is Record<string, unknown> =>
						part !== null && typeof part === "object" && !Array.isArray(part),
				)
				.map((part) => structuredClone(part))
		: undefined;
}

export function providerFieldsWithGoogleContentParts(
	parts: Record<string, unknown>[],
): Record<string, unknown> {
	return { google: { content_parts: structuredClone(parts) } };
}

/* ===================================================== THOUGHT SIGNATURES ===
 * Gemini per-tool-call signatures, canonical form `extraContent.google.thought_signature`.
 */

/** Signature from canonical tool-call extraContent (google namespace), if any. */
export function thoughtSignatureFromExtraContent(
	extraContent: Record<string, unknown> | undefined,
): string | undefined {
	const google = recordValue(extraContent?.google);
	const signature = google?.thought_signature ?? google?.thoughtSignature;
	return typeof signature === "string" && signature.length > 0
		? signature
		: undefined;
}

export function providerSpecificFieldsFromExtraContent(
	extraContent: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	const signature = thoughtSignatureFromExtraContent(extraContent);
	if (signature === undefined) return undefined;
	return { thought_signature: signature };
}

export function extraContentFromProviderSpecificFields(
	value: unknown,
): Record<string, unknown> | undefined {
	const fields = recordValue(value);
	const signature = fields?.thought_signature ?? fields?.thoughtSignature;
	if (typeof signature !== "string" || signature.length === 0) return undefined;
	return { google: { thought_signature: signature } };
}

/**
 * Appends `__thought__<signature>` to a tool call id for the public wire format. No-op when the
 * id is empty, no signature is present, or the id already carries a separator (idempotent).
 */
export function encodeThoughtSignatureId(
	id: string,
	extraContent: Record<string, unknown> | undefined,
): string {
	if (id.length === 0 || id.includes(LITELLM_THOUGHT_SEPARATOR)) return id;
	const signature = thoughtSignatureFromExtraContent(extraContent);
	if (signature === undefined) return id;
	// Keep this carrier lossless. OpenAI does not document a length limit for tool-call/call ids,
	// while Gemini signatures routinely make the combined value longer than 64 characters. Rich
	// clients can use the extension fields, but standard-only clients need the id to replay state.
	return `${id}${LITELLM_THOUGHT_SEPARATOR}${signature}`;
}

/**
 * Splits a public tool call id on the first `__thought__` occurrence. The suffix is always
 * removed from the id, even when the embedded signature is empty; `extraContent` is only
 * returned for a non-empty signature.
 */
export function decodeThoughtSignatureId(id: unknown): {
	id: string;
	extraContent?: Record<string, unknown>;
} {
	if (typeof id !== "string") return { id: "" };
	const index = id.indexOf(LITELLM_THOUGHT_SEPARATOR);
	if (index < 0) return { id };
	const signature = id.slice(index + LITELLM_THOUGHT_SEPARATOR.length);
	const clean = id.slice(0, index);
	return signature.length > 0
		? { id: clean, extraContent: { google: { thought_signature: signature } } }
		: { id: clean };
}

/** Strips an embedded signature from tool-result references (tool_call_id / call_id / tool_use_id). */
export function stripThoughtSignatureId(id: string): string {
	const index = id.indexOf(LITELLM_THOUGHT_SEPARATOR);
	return index < 0 ? id : id.slice(0, index);
}

export function thoughtSignaturesFromToolCalls(
	toolCalls: Array<{ extraContent?: Record<string, unknown> }> | undefined,
): string[] {
	const signatures: string[] = [];
	for (const tc of toolCalls ?? []) {
		const signature = thoughtSignatureFromExtraContent(tc.extraContent);
		if (signature !== undefined) signatures.push(signature);
	}
	return signatures;
}

export function providerSpecificFieldsFromToolCalls(
	toolCalls: Array<{ extraContent?: Record<string, unknown> }> | undefined,
): Record<string, unknown> | undefined {
	const thoughtSignatures = thoughtSignaturesFromToolCalls(toolCalls);
	return thoughtSignatures.length > 0
		? { thought_signatures: thoughtSignatures }
		: undefined;
}

/* ============================================== OPENAI REASONING STATE ===
 * OpenAI /responses per-item reasoning state (`reasoning` items with `encrypted_content`),
 * canonical form `message.providerFields.openai.reasoning`.
 */

export interface OpenAIReasoningStateItem {
	id?: string;
	encrypted_content: string;
	summary?: unknown[];
	content?: unknown[];
}

/**
 * Identifies the native Responses reasoning item that owns streamed summary deltas.
 * Keeping this separate from the encrypted state lets adapters preserve event identity
 * without pretending that state is available before `response.output_item.done`.
 */
export function providerFieldsWithOpenAIReasoningItemId(
	id: string,
): Record<string, unknown> {
	return { openai: { responses: { reasoning_item_id: id } } };
}

/** Reads the native Responses reasoning item id attached to a canonical stream delta. */
export function openaiReasoningItemIdFromProviderFields(
	fields: Record<string, unknown> | undefined,
): string | undefined {
	const openai = recordValue(fields?.openai);
	const responses = recordValue(openai?.responses);
	const id = responses?.reasoning_item_id;
	return typeof id === "string" && id.length > 0 ? id : undefined;
}

function pruneOpenAIResponsesNamespaces(
	copy: Record<string, unknown>,
	openai: Record<string, unknown> | undefined,
	responses: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (
		responses !== undefined &&
		Object.keys(responses).length === 0 &&
		openai !== undefined
	)
		delete openai.responses;
	if (openai !== undefined && Object.keys(openai).length === 0)
		delete copy.openai;
	return Object.keys(copy).length > 0 ? copy : undefined;
}

/** Removes internal Responses stream carriers before provider fields reach a public message. */
export function withoutOpenAIResponsesStreamMetadata(
	fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (fields === undefined) return undefined;
	const copy = structuredClone(fields);
	const openai = recordValue(copy.openai);
	const responses = recordValue(openai?.responses);
	if (responses !== undefined) {
		delete responses.stream_event;
		delete responses.stream_output;
	}
	return pruneOpenAIResponsesNamespaces(copy, openai, responses);
}

/**
 * Removes Responses reasoning state that is rendered as native output items before fields reach a
 * public message item. Keeping a second copy on the message would replay the same reasoning id twice.
 */
export function withoutOpenAIResponsesReasoningState(
	fields: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (fields === undefined) return undefined;
	const copy = structuredClone(fields);
	const openai = recordValue(copy.openai);
	if (openai !== undefined) delete openai.reasoning;
	const responses = recordValue(openai?.responses);
	if (responses !== undefined) {
		delete responses.reasoning_item_id;
		delete responses.stream_event;
		delete responses.stream_output;
	}
	return pruneOpenAIResponsesNamespaces(copy, openai, responses);
}

/** Builds the provider-namespaced record `{ openai: { reasoning: [...] } }`. */
export function providerFieldsWithOpenAIReasoning(
	items: OpenAIReasoningStateItem[],
): Record<string, unknown> {
	return { openai: { reasoning: structuredClone(items) } };
}

/** Reads and validates OpenAI reasoning state items out of a providerFields record. */
export function openaiReasoningFromProviderFields(
	fields: Record<string, unknown> | undefined,
): OpenAIReasoningStateItem[] | undefined {
	const openai = recordValue(fields?.openai);
	const reasoning = openai?.reasoning;
	if (!Array.isArray(reasoning)) return undefined;
	const items: OpenAIReasoningStateItem[] = [];
	for (const raw of reasoning) {
		const item = recordValue(raw);
		if (item === undefined) continue;
		if (
			typeof item.encrypted_content !== "string" ||
			item.encrypted_content.length === 0
		)
			continue;
		items.push({
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
		});
	}
	return items.length > 0 ? items : undefined;
}
