import { getCachedVirtualKey } from "./virtualKeyCache.ts";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv, Auth } from "./types.ts";
import { env } from "#config/env.ts";

const MASTER_KEY_DIGEST = createHash("sha256").update(env.MASTER_KEY).digest();

function isMasterKey(value: string): boolean {
	const candidateDigest = createHash("sha256").update(value).digest();
	return timingSafeEqual(candidateDigest, MASTER_KEY_DIGEST);
}

/** Extracts an API key only from headers, which do not leak through URLs, history, or referrers. */
function extractKey(c: Context): string | undefined {
	const auth = c.req.header("authorization");
	if (auth) {
		const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
		if (m) return m[1]!.trim();
		return auth.trim();
	}
	const x = c.req.header("x-api-key");
	return x ? x.trim() : undefined;
}

/** Resolves and revalidates request credentials. WebSocket sessions call this before every turn. */
export async function authenticateRequest(c: Context): Promise<Auth> {
	const key = extractKey(c);
	if (!key) {
		throw new GatewayError({
			class: "auth",
			message: "Missing API key (Authorization: Bearer <key>)",
		});
	}

	if (isMasterKey(key)) return { type: "master" };

	const vk = await getCachedVirtualKey(key);
	if (!vk)
		throw new GatewayError({ class: "auth", message: "Invalid API key" });
	if (!vk.enabled)
		throw new GatewayError({ class: "auth", message: "API key is disabled" });
	if (vk.expiresAt && new Date(vk.expiresAt).getTime() < Date.now()) {
		throw new GatewayError({ class: "auth", message: "API key has expired" });
	}
	return { type: "virtual", key: vk };
}

/** Resolves the identity (master or virtual key) and stores it in c.get('auth'). */
export function authMiddleware(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		c.set("auth", await authenticateRequest(c));
		return next();
	};
}

/** Requires the resolved auth to be the master key (for /admin). */
export function requireMaster(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const auth = c.get("auth") as Auth | undefined;
		if (auth?.type !== "master") {
			throw new GatewayError({
				class: "permission",
				message: "This operation requires the master key",
			});
		}
		return next();
	};
}

export function getAuth(c: Context<AppEnv>): Auth {
	return c.get("auth");
}
