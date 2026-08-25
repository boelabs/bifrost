import { GatewayError, type ErrorClass } from "#core/errors.ts";
import type { AdapterContext, UpstreamError } from "./types.ts";

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

interface UpstreamErrorDetail {
	message?: string;
	param?: string;
	code?: string;
}

const PUBLIC_MESSAGE_MAX_CHARS = 4_096;
const PUBLIC_FIELD_MAX_CHARS = 512;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: null;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Reads the common OpenAI envelope plus the root-level shape used by Cohere-like APIs. */
function upstreamDetail(body: unknown): UpstreamErrorDetail {
	const root = record(body);
	if (!root) return {};
	const nested = record(root.error);
	const message =
		nonEmptyString(nested?.message) ??
		nonEmptyString(root.error) ??
		nonEmptyString(root.message);
	const param = nonEmptyString(nested?.param) ?? nonEmptyString(root.param);
	const code = nonEmptyString(nested?.code) ?? nonEmptyString(root.code);
	return {
		...(message !== undefined ? { message } : {}),
		...(param !== undefined ? { param } : {}),
		...(code !== undefined ? { code } : {}),
	};
}

function collectSensitiveStrings(
	value: unknown,
	output: Set<string>,
	depth = 0,
): void {
	if (depth > 4 || value === null) return;
	if (typeof value === "string") {
		if (value !== "") output.add(value);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectSensitiveStrings(item, output, depth + 1);
		return;
	}
	const object = record(value);
	if (!object) return;
	for (const child of Object.values(object))
		collectSensitiveStrings(child, output, depth + 1);
}

function identifierCharacter(value: string | undefined): boolean {
	return value !== undefined && /[A-Za-z0-9_./-]/.test(value);
}

function redactSensitiveValue(input: string, sensitive: string): string {
	if (sensitive.length >= 4) return input.split(sensitive).join("[redacted]");
	let output = "";
	let offset = 0;
	while (offset < input.length) {
		const index = input.indexOf(sensitive, offset);
		if (index < 0) return output + input.slice(offset);
		const before = index === 0 ? undefined : input[index - 1];
		const after = input[index + sensitive.length];
		output += input.slice(offset, index);
		if (!identifierCharacter(before) && !identifierCharacter(after)) {
			output += "[redacted]";
		} else {
			output += sensitive;
		}
		offset = index + sensitive.length;
	}
	return output;
}

function publicProviderField(
	value: string,
	ctx: Pick<AdapterContext, "upstreamModel" | "credentials"> | undefined,
	maxChars: number,
): string {
	let safe = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0) ?? 0;
		const forbiddenControl =
			(codePoint < 32 &&
				codePoint !== 9 &&
				codePoint !== 10 &&
				codePoint !== 13) ||
			codePoint === 127;
		safe += forbiddenControl ? " " : character;
	}
	const sensitive = new Set<string>();
	if (ctx) {
		if (ctx.upstreamModel !== "") sensitive.add(ctx.upstreamModel);
		collectSensitiveStrings(ctx.credentials, sensitive);
	}
	for (const secret of [...sensitive].sort((a, b) => b.length - a.length)) {
		safe = redactSensitiveValue(safe, secret);
	}
	return safe.length <= maxChars ? safe : `${safe.slice(0, maxChars - 1)}…`;
}

function exposesRequestDetail(cls: ErrorClass, status: number): boolean {
	return (
		status >= 400 &&
		status < 500 &&
		(cls === "bad_request" ||
			cls === "context_window" ||
			cls === "content_policy")
	);
}

/** Translates any upstream failure (abort, non-2xx HTTP, network exception) to a `GatewayError`. */
export function mapUpstreamHttpError(
	err: unknown,
	mapping: UpstreamErrorMapping,
	ctx?: Pick<AdapterContext, "upstreamModel" | "credentials">,
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
		const detail = upstreamDetail(up.body);
		const message =
			detail.message ?? `${label} upstream error (HTTP ${up.status})`;
		let cls =
			mapping.classifyBody?.(up.status, up.body) ?? classifyStatus(up.status);
		if (cls === "bad_request" && mapping.refineBadRequest) {
			cls = mapping.refineBadRequest(message, up.body) ?? cls;
		}
		// The raw body remains private. Only bounded scalar request-error fields are eligible for the
		// public response; operational 4xx and every 5xx keep the canonical generic message.
		const headerRetryAfterMs = parseRetryAfter(up.headers?.["retry-after"]);
		const retryAfterMs =
			headerRetryAfterMs ?? mapping.retryAfterMs?.(up.status, up.body);
		const exposeDetail = exposesRequestDetail(cls, up.status);
		const is4xx = up.status >= 400 && up.status < 500;
		return new GatewayError({
			class: cls,
			message,
			status: up.status,
			...(exposeDetail && detail.message !== undefined
				? {
						publicMessage: publicProviderField(
							detail.message,
							ctx,
							PUBLIC_MESSAGE_MAX_CHARS,
						),
					}
				: {}),
			...(is4xx && detail.param !== undefined
				? {
						param: publicProviderField(
							detail.param,
							ctx,
							PUBLIC_FIELD_MAX_CHARS,
						),
					}
				: {}),
			...(is4xx && detail.code !== undefined
				? {
						code: publicProviderField(detail.code, ctx, PUBLIC_FIELD_MAX_CHARS),
					}
				: {}),
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
