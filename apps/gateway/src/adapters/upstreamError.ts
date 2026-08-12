import { GatewayError, type ErrorClass } from "#core/errors.ts";
import type { UpstreamError } from "./types.ts";

import {
	describeUnknownError,
	parseRetryAfter,
	classifyStatus,
	isAbortError,
} from "#core/httpError.ts";

/**
 * How an adapter maps an upstream error to a `GatewayError`. The common chain (abort -> timeout,
 * HTTP status -> class, network failure -> server, provider detail -> logs) lives here; each provider
 * only contributes what actually differs via the hooks.
 */
export interface UpstreamErrorMapping {
	/** Readable provider prefix for the internal messages (e.g. "OpenAI", "Google"). */
	label: string;
	/**
	 * Provider-specific classification from the body, BEFORE falling back to `classifyStatus`.
	 * E.g. Anthropic maps `error.type` (rate_limit_error, authentication_error...). Returns `null` to
	 * delegate to the HTTP status.
	 */
	classifyBody?: (status: number, body: unknown) => ErrorClass | null;
	/**
	 * Refines a 400 (`bad_request`) to a more specific class, keeping status and provider.
	 * E.g. `context_window` by message, `content_policy` by code. Returns `null` if it does not apply.
	 */
	refineBadRequest?: (message: string, body: unknown) => ErrorClass | null;
	/** Provider-body retry hint used when the HTTP Retry-After header is absent. */
	retryAfterMs?: (status: number, body: unknown) => number | undefined;
}

function upstreamMessage(body: unknown, label: string, status: number): string {
	return (
		(body as { error?: { message?: string } })?.error?.message ??
		(body as { message?: string })?.message ??
		`${label} upstream error (HTTP ${status})`
	);
}

/** Translates any upstream failure (abort, non-2xx HTTP, network exception) to a `GatewayError`. */
export function mapUpstreamHttpError(
	err: unknown,
	mapping: UpstreamErrorMapping,
): GatewayError {
	if (GatewayError.is(err)) return err;
	const { label } = mapping;
	if (isAbortError(err)) {
		return new GatewayError({
			class: "timeout",
			message: `${label}: the request timed out or was cancelled`,
		});
	}
	const up = err as UpstreamError;
	if (typeof up?.status === "number") {
		const message = upstreamMessage(up.body, label, up.status);
		let cls =
			mapping.classifyBody?.(up.status, up.body) ?? classifyStatus(up.status);
		if (cls === "bad_request" && mapping.refineBadRequest) {
			cls = mapping.refineBadRequest(message, up.body) ?? cls;
		}
		// Provider detail -> logs (raw provider); the client sees the generic public message.
		const headerRetryAfterMs = parseRetryAfter(up.headers?.["retry-after"]);
		const retryAfterMs =
			headerRetryAfterMs ?? mapping.retryAfterMs?.(up.status, up.body);
		return new GatewayError({
			class: cls,
			message,
			status: up.status,
			provider: { status: up.status, body: up.body },
			...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
			...(up.headers?.["retry-after"] !== undefined
				? { headers: { "Retry-After": up.headers["retry-after"] } }
				: {}),
		});
	}
	const d = describeUnknownError(err);
	return new GatewayError({
		class: "server",
		message: `${label}: ${d.message}`,
		provider: { body: d.body },
		cause: err,
	});
}
