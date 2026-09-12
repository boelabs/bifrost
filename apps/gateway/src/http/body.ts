import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Context } from "hono";

/**
 * JSON requests may contain inline images or files whose decoded limit is 50 MB. The extra room
 * covers base64 expansion and the surrounding request without leaving the process unbounded.
 */
export const PUBLIC_JSON_BODY_MAX_BYTES = 72 * 1024 * 1024;

/** Admin payloads include extension source (limited to 1 MB) plus normal configuration metadata. */
export const ADMIN_JSON_BODY_MAX_BYTES = 2 * 1024 * 1024;

function bodyTooLarge(maxBytes: number): GatewayError {
	return new GatewayError({
		class: "bad_request",
		status: 413,
		code: "request_body_too_large",
		message: `Request body exceeds ${maxBytes} bytes`,
		publicMessage: `Request body exceeds the ${maxBytes} byte limit.`,
	});
}

function declaredContentLength(c: Context<AppEnv>): number | null {
	const raw = c.req.header("content-length");
	if (raw === undefined) return null;
	const parsed = Number(raw);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Reads a JSON body through a byte-counting stream. The reader is cancelled as soon as the hard
 * limit is crossed, including for chunked requests without Content-Length.
 */
export async function readJsonBody(
	c: Context<AppEnv>,
	maxBytes: number,
): Promise<unknown> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
		throw new Error("maxBytes must be a positive safe integer");

	const declared = declaredContentLength(c);
	if (declared !== null && declared > maxBytes) throw bodyTooLarge(maxBytes);

	const stream = c.req.raw.body;
	if (stream === null)
		throw new GatewayError({
			class: "bad_request",
			message: "Invalid or missing JSON body",
		});

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader
					.cancel("request body limit exceeded")
					.catch(() => undefined);
				throw bodyTooLarge(maxBytes);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	try {
		const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return JSON.parse(text) as unknown;
	} catch {
		throw new GatewayError({
			class: "bad_request",
			message: "Invalid or missing JSON body",
		});
	}
}

/**
 * Reads and validates a MANAGEMENT request body, reporting exactly what was wrong.
 *
 * `GatewayError` defaults `publicMessage` to a generic per-class sentence, which is right for
 * inference: we are a router, the same public model can resolve to different deployments, and the
 * client must not receive a provider's wording. None of that applies here. The caller is an
 * authenticated operator, the subject is their own request body, and "The request is invalid." with a
 * `param` is strictly less useful than saying which field failed and why — there is nothing to leak in
 * describing an input the caller just sent.
 */
export async function parseJsonBody<T>(
	c: Context<AppEnv>,
	schema: { safeParse: (value: unknown) => ParseResult<T> },
	maxBytes: number = ADMIN_JSON_BODY_MAX_BYTES,
): Promise<T> {
	const json = await readJsonBody(c, maxBytes);
	const parsed = schema.safeParse(json);
	if (parsed.success) return parsed.data;

	// An issue at the root of the body (an unrecognized key, say) carries no path, and prefixing it
	// with ": " reads like a missing field name rather than a whole-body problem.
	const detail = parsed.error.issues
		.map((issue) => {
			const field = issue.path.join(".");
			return field ? `${field}: ${issue.message}` : issue.message;
		})
		.join("; ");
	const first = parsed.error.issues[0];
	throw new GatewayError({
		class: "bad_request",
		message: detail,
		publicMessage: detail,
		param: first ? first.path.join(".") : null,
	});
}

/** Structural subset of a Zod safeParse result, so this module does not depend on a Zod version. */
type ParseResult<T> =
	| { success: true; data: T }
	| {
			success: false;
			error: { issues: { path: PropertyKey[]; message: string }[] };
	  };
