import { GatewayError } from "./errors.ts";

/**
 * Maps an infrastructure/connectivity failure (Postgres or Redis unreachable) to a clean 503 with a
 * Retry-After header, instead of letting it fall through to an opaque 500. A 503 + Retry-After tells
 * clients and load balancers to back off and retry, which is the correct behavior during a dependency
 * blip — a 500 reads as "this request is broken, don't retry".
 */

/** Seconds clients should wait before retrying when a dependency is unavailable. */
export const DEPENDENCY_RETRY_AFTER_SECONDS = 5;

// Connection-level error codes emitted by Node sockets, ioredis and postgres-js when a dependency is
// unreachable. Kept conservative: only connectivity, never application errors.
const DEPENDENCY_ERROR_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"EPIPE",
	"ENOTFOUND",
	"EHOSTUNREACH",
	"EAI_AGAIN",
	"CONNECTION_ENDED",
	"CONNECTION_CLOSED",
	"CONNECTION_DESTROYED",
]);

const DEPENDENCY_MESSAGE_RE =
	/(Connection is closed|Reached the max retries|Stream isn't writeable|Connection ended|Connection terminated|getaddrinfo)/i;

/** True if `err` looks like a transient dependency-connectivity failure rather than a request bug. */
export function isDependencyError(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const code = (err as { code?: unknown }).code;
	if (typeof code === "string" && DEPENDENCY_ERROR_CODES.has(code)) return true;
	// ioredis raises this once it exhausts maxRetriesPerRequest against a down server.
	if ((err as { name?: unknown }).name === "MaxRetriesPerRequestError")
		return true;
	const message = (err as { message?: unknown }).message;
	return typeof message === "string" && DEPENDENCY_MESSAGE_RE.test(message);
}

/** Wraps a dependency failure as a 503 GatewayError carrying Retry-After. */
export function dependencyUnavailable(cause: unknown): GatewayError {
	return new GatewayError({
		class: "server",
		status: 503,
		code: "service_unavailable",
		message: `Dependency unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
		headers: { "retry-after": String(DEPENDENCY_RETRY_AFTER_SECONDS) },
		cause,
	});
}
