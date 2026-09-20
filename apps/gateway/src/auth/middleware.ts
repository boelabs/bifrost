import { getCachedVirtualKey } from "./virtualKeyCache.ts";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { type Permission, roleHas } from "./roles.ts";
import type { AppEnv, Auth } from "./types.ts";
import { GatewayError } from "#core/errors.ts";
import { assertCsrfToken } from "./csrf.ts";
import { getCookie } from "hono/cookie";
import { env } from "#config/env.ts";

import {
	SESSION_COOKIE,
	resolveSession,
	CSRF_COOKIE,
	CSRF_HEADER,
} from "./session.ts";

const MASTER_KEY_DIGEST = createHash("sha256").update(env.MASTER_KEY).digest();

function isMasterKey(value: string): boolean {
	const candidateDigest = createHash("sha256").update(value).digest();
	return timingSafeEqual(candidateDigest, MASTER_KEY_DIGEST);
}

/** Extracts an API key only from headers, which do not leak through URLs, history, or referrers. */
function extractKey(c: Context): string | undefined {
	const auth = c.req.header("authorization");
	if (auth) {
		const bearer = /^Bearer\s+(.+)$/i.exec(auth.trim())?.[1];
		if (bearer !== undefined) {
			return bearer.trim();
		}
		return auth.trim();
	}
	const x = c.req.header("x-api-key");
	return x ? x.trim() : undefined;
}

/** Resolves and revalidates request credentials. WebSocket sessions call this before every turn. */
export async function authenticateRequest(c: Context): Promise<Auth> {
	const key = extractKey(c);

	// A cookie is only consulted when no header credential was sent, so an explicit key always wins.
	if (key === undefined) {
		const sessionToken = env.DASH_ENABLED
			? getCookie(c, SESSION_COOKIE)
			: undefined;
		if (sessionToken) {
			const session = await resolveSession(sessionToken);
			if (!session) {
				throw new GatewayError({
					class: "auth",
					code: "session_invalid",
					message: "Session is expired, revoked, or unknown",
				});
			}
			assertCsrfToken(
				c.req.method,
				getCookie(c, CSRF_COOKIE),
				c.req.header(CSRF_HEADER),
			);
			return { type: "session", session };
		}
		throw new GatewayError({
			class: "auth",
			message: "Missing API key (Authorization: Bearer <key>)",
		});
	}

	if (isMasterKey(key)) {
		return { type: "master" };
	}

	const vk = await getCachedVirtualKey(key);
	if (!vk) {
		throw new GatewayError({ class: "auth", message: "Invalid API key" });
	}
	if (!vk.enabled) {
		throw new GatewayError({ class: "auth", message: "API key is disabled" });
	}
	if (vk.expiresAt && new Date(vk.expiresAt).getTime() < Date.now()) {
		throw new GatewayError({ class: "auth", message: "API key has expired" });
	}
	return { type: "virtual", key: vk };
}

/** Resolves the identity (master key, virtual key, or session) and stores it in c.get('auth'). */
export function authMiddleware(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		c.set("auth", await authenticateRequest(c));
		return next();
	};
}

/**
 * Requires an identity allowed to administer the gateway: the master key, or a session whose role
 * carries `permission`. A virtual key never administers anything.
 */
export function requirePermission(
	permission: Permission,
): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const auth = c.get("auth") as Auth | undefined;
		if (auth?.type === "master") {
			return next();
		}
		if (auth?.type === "session" && roleHas(auth.session.role, permission)) {
			return next();
		}
		throw new GatewayError({
			class: "permission",
			code: "insufficient_permission",
			message: `This operation requires the "${permission}" permission`,
		});
	};
}

/** Requires the resolved auth to be the master key or a session (i.e. not a virtual key). */
export function requireOperator(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const auth = c.get("auth") as Auth | undefined;
		if (auth?.type === "master" || auth?.type === "session") {
			return next();
		}
		throw new GatewayError({
			class: "permission",
			message: "This operation requires the master key or an operator session",
		});
	};
}

export function getAuth(c: Context<AppEnv>): Auth {
	return c.get("auth");
}
