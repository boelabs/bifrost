import type { MessagesTokenCountRequest } from "./messages.ts";

/** Deterministic portable fallback for providers without a native token-count API. */
export function estimateMessagesInputTokens(
	request: MessagesTokenCountRequest,
): number {
	const { model: _model, extra_body: _extraBody, ...input } = request;
	const bytes = new TextEncoder().encode(JSON.stringify(input)).byteLength;
	return Math.max(1, Math.ceil(bytes / 4));
}
