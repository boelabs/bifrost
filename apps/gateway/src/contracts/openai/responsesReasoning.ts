import type { OpenAIReasoningStateItem } from "#core/providerSpecificFields.ts";

type ReasoningPartType = "reasoning_text" | "summary_text";

function recordValue(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return undefined;
	return value as Record<string, unknown>;
}

function reasoningTexts(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const texts: string[] = [];
	for (const part of value) {
		if (typeof part === "string") {
			if (part.length > 0) texts.push(part);
			continue;
		}
		const text = recordValue(part)?.text;
		if (typeof text === "string" && text.length > 0) texts.push(text);
	}
	return texts;
}

function parts(
	texts: string[],
	type: ReasoningPartType,
): Record<string, unknown>[] {
	return texts.map((text) => ({ type, text }));
}

/**
 * Makes both public Responses representations of visible reasoning available without replacing
 * semantically distinct provider values when the provider already supplied both.
 */
export function mirrorReasoningItem(
	item: Record<string, unknown>,
): Record<string, unknown> {
	if (item.type !== "reasoning") return structuredClone(item);
	const mirrored = structuredClone(item);
	const summaryTexts = reasoningTexts(mirrored.summary);
	const contentTexts = reasoningTexts(mirrored.content);
	if (summaryTexts.length === 0 && contentTexts.length === 0) return mirrored;

	if (summaryTexts.length === 0 && contentTexts.length > 0)
		mirrored.summary = parts(contentTexts, "summary_text");
	else if (!Array.isArray(mirrored.summary)) mirrored.summary = [];

	if (contentTexts.length === 0 && summaryTexts.length > 0)
		mirrored.content = parts(summaryTexts, "reasoning_text");
	else if (!Array.isArray(mirrored.content)) mirrored.content = [];

	return mirrored;
}

/**
 * Renders stored reasoning state as an input item for an upstream Responses request.
 *
 * Deliberately not `mirrorReasoningItem`: mirroring exists so *clients* receive both public
 * representations, and the half it synthesizes is gateway state the provider never produced.
 * Request schemas accept `content` on a reasoning item only as an empty array — OpenAI-style
 * upstreams answer `array_above_max_length` for anything else — so replay carries only what the
 * upstream itself returned: its id, its encrypted state, and its summary.
 */
export function reasoningItemForRequest(
	item: OpenAIReasoningStateItem,
): Record<string, unknown> {
	return {
		type: "reasoning",
		...(item.id !== undefined ? { id: item.id } : {}),
		encrypted_content: item.encrypted_content,
		summary: structuredClone(item.summary ?? []),
	};
}

export function mirrorReasoningOutput(
	output: Record<string, unknown>[],
): Record<string, unknown>[] {
	return output.map(mirrorReasoningItem);
}

export function reasoningTextFromItem(item: Record<string, unknown>): string[] {
	const summary = reasoningTexts(item.summary);
	return summary.length > 0 ? summary : reasoningTexts(item.content);
}

/** Mirrors reasoning items nested in item-scoped and terminal Responses stream payloads. */
export function mirrorReasoningEventData(
	data: Record<string, unknown>,
): Record<string, unknown> {
	const mirrored = structuredClone(data);
	const item = recordValue(mirrored.item);
	if (item !== undefined) mirrored.item = mirrorReasoningItem(item);
	const response = recordValue(mirrored.response);
	if (response !== undefined && Array.isArray(response.output)) {
		response.output = response.output.map((outputItem) => {
			const outputRecord = recordValue(outputItem);
			return outputRecord === undefined
				? structuredClone(outputItem)
				: mirrorReasoningItem(outputRecord);
		});
	}
	return mirrored;
}
