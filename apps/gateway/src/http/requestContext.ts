import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "#auth/types.ts";
import { randomUUID } from "node:crypto";

const MAX_REQUEST_ID_LENGTH = 128;

function incomingRequestId(c: Context): string | null {
	const raw = c.req.header("x-request-id")?.trim();
	if (!raw || raw.length > MAX_REQUEST_ID_LENGTH) return null;
	return raw;
}

export function requestContextMiddleware(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const requestId = incomingRequestId(c) ?? randomUUID();
		c.set("requestId", requestId);
		// WebSocket upgrade headers are owned by the adapter and become immutable during upgrade.
		if (c.req.header("upgrade")?.toLowerCase() !== "websocket")
			c.header("x-request-id", requestId);
		await next();
	};
}

export function getRequestId(c: Context<AppEnv>): string {
	return c.get("turnRequestId") ?? c.get("requestId");
}

export function setHeaders(c: Context, headers: Record<string, string>): void {
	for (const [name, value] of Object.entries(headers)) {
		c.header(name, value);
	}
}
