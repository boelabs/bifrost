import type { ErrorClass } from "./errors.ts";

/** Base classification by HTTP status. Adapters can refine it (e.g. 400 -> context_window). */
export function classifyStatus(status: number): ErrorClass {
	if (status === 401 || status === 403) return "auth";
	if (status === 404) return "not_found";
	if (status === 429) return "rate_limit";
	if (status === 408 || status === 504) return "timeout";
	if (status >= 500) return "server";
	// A provider-side 4xx is a rejection of this request or deployment configuration. It is never
	// evidence of a transient server outage merely because the gateway does not recognize the exact
	// status (402, 409, 413, 415, 425, 451, ...).
	if (status >= 400 && status < 500) return "bad_request";
	return "server";
}

/** Parses Retry-After as either delta-seconds or an HTTP date. Invalid/past values return undefined. */
export function parseRetryAfter(
	value: string | null | undefined,
	nowMs = Date.now(),
): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0)
		return Math.min(Math.ceil(seconds * 1000), 86_400_000);
	const dateMs = Date.parse(value);
	if (!Number.isFinite(dateMs)) return undefined;
	const delay = dateMs - nowMs;
	return delay > 0 ? Math.min(delay, 86_400_000) : undefined;
}

/** Is the error an AbortController cancellation/timeout? Robust to non-Error DOMException. */
export function isAbortError(err: unknown): boolean {
	const name = (err as { name?: unknown } | null)?.name;
	return name === "AbortError" || name === "TimeoutError";
}

/**
 * Serializes a NON-HTTP error (fetch rejection, non-Error exception, arbitrary thrown value) into a
 * readable message + a loggable body. Avoids the opaque "unknown error": captures name/message/
 * stack/cause from Errors and `String(err)` for the rest, so the real detail reaches the logs.
 */
export function describeUnknownError(err: unknown): {
	message: string;
	body: unknown;
} {
	if (err instanceof Error) {
		const body: Record<string, unknown> = {
			name: err.name,
			message: err.message,
		};
		if (err.stack) body.stack = err.stack;
		// `fetch failed` often hides the real cause (ECONNRESET, TLS...) in err.cause.
		if (err.cause !== undefined)
			body.cause =
				err.cause instanceof Error ? err.cause.message : String(err.cause);
		return { message: err.message || err.name || "unknown error", body };
	}
	return { message: String(err), body: { value: String(err) } };
}

/**
 * Heuristic to reclassify a generic 400/422 as `context_window` from the provider's message, when no
 * explicit code (`context_length_exceeded`) is present. Each upstream reports it differently and
 * rarely with a code; without this, an over-long prompt would stay `bad_request` and would NOT trigger
 * the context_window fallback. Known phrasings (Jun 2026):
 *   - OpenAI:    "maximum context length is N tokens" (+ code context_length_exceeded)
 *   - Anthropic: "prompt is too long: N tokens > M maximum"
 *   - Gemini:    "The input token count (N) exceeds the maximum number of tokens allowed (M)"
 *   - Kimi:      "Input token length too long" / "Your request exceeded model token limit : N"
 *   - generic:   "context window", "reduce the length", "too many tokens", "token limit exceeded"
 * Only applied on 400/422 (see adapters), so "token limit" does not collide with rate limits (429).
 *
 * A misclassification is not cosmetic: `context_window` selects the operator's context-window
 * fallback, so the request is re-sent to another deployment and the client is told the context
 * overflowed. Every phrasing here must be about the context, never about length alone.
 */
const CONTEXT_PHRASES =
	/context (?:length|window)|maximum context|input token (?:count|length)|token limit|exceed(?:s|ed)?[^.]*\btokens?\b|reduce the (?:length|number of (?:input )?tokens)|too many (?:input )?tokens/i;

/**
 * "too long" on its own is how providers report *any* length violation — a schema array, a string
 * field ("array too long. Expected an array with maximum length 0"). It identifies the context
 * window only when the message is also about tokens or the context.
 */
const TOO_LONG = /\btoo long\b/i;
const TOKENS_OR_CONTEXT = /\btokens?\b|\bcontext\b/i;

export function looksLikeContextWindowError(
	message: string | undefined,
): boolean {
	if (!message) return false;
	if (CONTEXT_PHRASES.test(message)) return true;
	return TOO_LONG.test(message) && TOKENS_OR_CONTEXT.test(message);
}
