import { ADMIN_JSON_BODY_MAX_BYTES } from "./body.ts";
import { type AppEnv, actorOf } from "#auth/types.ts";
import { GatewayError } from "#core/errors.ts";
import type { MiddlewareHandler } from "hono";
import { getAuth } from "#auth/middleware.ts";
import { createHash } from "node:crypto";

import {
	completeIdempotencyKey,
	releaseIdempotencyKey,
	claimIdempotencyKey,
} from "#db/repos/idempotency.ts";

export const IDEMPOTENCY_HEADER = "idempotency-key";
export const IDEMPOTENCY_REPLAY_HEADER = "idempotent-replay";
/** Long enough to cover a retry loop or an operator coming back after a timeout; short enough to forget. */
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;
const MAX_KEY_LENGTH = 255;

/**
 * The request, reduced to a value that changes whenever the request does.
 *
 * The body is read from a clone, so the handler still gets an untouched stream — the byte-capped
 * reader in `body.ts` runs exactly as it would without this middleware.
 */
async function fingerprint(
	request: Request,
	method: string,
	path: string,
): Promise<string> {
	const hash = createHash("sha256").update(`${method}\n${path}\n`);
	const body = await request.clone().arrayBuffer();
	hash.update(Buffer.from(body));
	return hash.digest("hex");
}

function replay(status: number, response: unknown): Response {
	const headers = new Headers({ [IDEMPOTENCY_REPLAY_HEADER]: "true" });
	if (response === null || response === undefined) {
		return new Response(null, { status, headers });
	}
	headers.set("content-type", "application/json");
	return new Response(JSON.stringify(response), { status, headers });
}

/**
 * `Idempotency-Key` support for the calls that create things.
 *
 * A dashboard that retries a create — a double-clicked button, a reconnect after a timeout — has no
 * way to tell "it worked and the answer was lost" from "it never happened", and guessing wrong means
 * two virtual keys where the operator asked for one. Sending the same key with the retry makes the
 * gateway answer that question: the first call's response comes back, and nothing is created twice.
 *
 * Opt-in by design. A request without the header behaves exactly as it did before.
 */
export function idempotencyMiddleware(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const key = c.req.header(IDEMPOTENCY_HEADER)?.trim();
		if (!key || c.req.method !== "POST") {
			return next();
		}
		if (key.length > MAX_KEY_LENGTH) {
			throw new GatewayError({
				class: "bad_request",
				code: "invalid_idempotency_key",
				message: `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters`,
				publicMessage: `Idempotency-Key must be at most ${MAX_KEY_LENGTH} characters.`,
			});
		}

		// An over-sized body is rejected by the handler's own reader; fingerprinting it here would
		// buffer exactly what that limit exists to avoid.
		const declared = Number(c.req.header("content-length") ?? 0);
		if (Number.isFinite(declared) && declared > ADMIN_JSON_BODY_MAX_BYTES) {
			return next();
		}

		const actor = actorOf(getAuth(c));
		const { path } = c.req;
		const print = await fingerprint(c.req.raw, c.req.method, path);
		const claim = await claimIdempotencyKey({
			actor,
			key,
			method: c.req.method,
			path,
			fingerprint: print,
			expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
		});

		if (!claim.claimed) {
			const { existing } = claim;
			if (existing.fingerprint !== print) {
				throw new GatewayError({
					class: "bad_request",
					status: 409,
					code: "idempotency_key_reuse",
					message: `Idempotency-Key "${key}" was already used for a different request`,
					publicMessage:
						"This Idempotency-Key was already used for a different request. Use a new key.",
				});
			}
			if (existing.status === null) {
				throw new GatewayError({
					class: "bad_request",
					status: 409,
					code: "idempotency_key_in_progress",
					message: `Idempotency-Key "${key}" is still in progress`,
					publicMessage:
						"The first request with this Idempotency-Key is still running. Retry in a moment.",
				});
			}
			return replay(existing.status, existing.response);
		}

		try {
			await next();
		} catch (error) {
			await releaseIdempotencyKey(actor, key).catch(() => undefined);
			throw error;
		}

		const { status } = c.res;
		// Only a success is worth replaying: a rejected body should be retried with the same key once
		// it is fixed, and a 500 may well succeed on the next attempt.
		if (status < 200 || status >= 300) {
			await releaseIdempotencyKey(actor, key).catch(() => undefined);
			return;
		}

		const text = await c.res.clone().text();
		let body: unknown = null;
		if (text !== "") {
			try {
				body = JSON.parse(text);
			} catch {
				// Every admin response is JSON or empty; anything else is not ours to replay, so the key
				// is given back rather than storing a body we cannot reproduce faithfully.
				await releaseIdempotencyKey(actor, key).catch(() => undefined);
				return;
			}
		}
		await completeIdempotencyKey(actor, key, status, body);
		c.res.headers.set(IDEMPOTENCY_REPLAY_HEADER, "false");
	};
}
