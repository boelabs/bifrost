import type { CanonicalChatStreamChunk } from "#core/canonical.ts";

/**
 * Wraps a stream of CANONICAL chunks and records (only once) the instant of the first real token
 * - visible reasoning, text content, or tool call - via `onFirstToken(epochMs)`. Measuring at the canonical layer
 * (not in each contract's public render) makes TTFT identical and provider-agnostic for
 * /v1/chat/completions, /v1/responses, and /v1/messages, regardless of how each render reorders events.
 *
 * `onChunk`, if given, fires on EVERY chunk (not just the first), at the moment it is received from
 * upstream - before it is rendered to the public contract or written to the client. Its last call
 * marks when upstream finished responding, decoupled from how long relaying the response to the
 * client then took; use it to time upstream latency instead of `Date.now()` taken after the client
 * write completes (which conflates upstream speed with the client's own transfer time).
 */
export async function* tapFirstToken(
	chunks: AsyncIterable<CanonicalChatStreamChunk>,
	onFirstToken: (epochMs: number) => void,
	onChunk?: (epochMs: number) => void,
): AsyncGenerator<CanonicalChatStreamChunk> {
	let seen = false;
	for await (const chunk of chunks) {
		const now = Date.now();
		onChunk?.(now);
		if (!seen) {
			const delta = chunk.choices[0]?.delta;
			if (
				delta?.reasoning ||
				delta?.content ||
				(delta?.toolCalls && delta.toolCalls.length > 0)
			) {
				seen = true;
				onFirstToken(now);
			}
		}
		yield chunk;
	}
}
