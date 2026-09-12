import type { Context, MiddlewareHandler } from "hono";
import { getRequestId } from "#http/requestContext.ts";
import { type AppEnv, actorOf } from "#auth/types.ts";
import { clientIp } from "#endpoints/shared.ts";
import { getAuth } from "#auth/middleware.ts";
import { adminAudit } from "#db/schema.ts";
import { log } from "#logging/log.ts";
import { db } from "#db/client.ts";

const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];

/**
 * Appends one row per mutating /admin call. Reads are not audited — they are the overwhelming
 * majority of dashboard traffic and would bury the entries that matter.
 *
 * `/admin/logs/:id/payload` is the deliberate exception in the other direction: it is a GET, but it
 * reveals real prompts and completions, and `payload_access_audit` already records it separately.
 */
export function auditMiddleware(): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		await next();
		if (!MUTATING.includes(c.req.method)) return;
		// Never audit a call that was rejected before it identified anyone.
		if (c.res.status === 401 || c.res.status === 403) return;
		void record(c);
	};
}

function targetOf(c: Context<AppEnv>): {
	targetType: string | null;
	targetId: string | null;
} {
	const segments = c.req.path.split("/").filter(Boolean); // ["admin", <resource>, ...]
	const resource = segments[1] ?? null;
	const id = c.req.param("id") ?? segments[2] ?? null;
	return {
		targetType: resource,
		targetId: id === resource ? null : id,
	};
}

/**
 * Fire-and-forget: an audit write must never fail the operation it describes, and it must never add
 * latency to the response. A failure is logged loudly because a silent gap in an audit trail is
 * worse than a noisy one.
 */
async function record(c: Context<AppEnv>): Promise<void> {
	try {
		const { targetType, targetId } = targetOf(c);
		await db.insert(adminAudit).values({
			actor: actorOf(getAuth(c)),
			action: `${c.req.method} ${c.req.path}`,
			targetType,
			targetId,
			requestId: getRequestId(c),
			status: c.res.status,
			ip: clientIp(c),
		});
	} catch (err) {
		log.error("audit", "failed to persist an admin audit entry", {
			err,
			path: c.req.path,
			method: c.req.method,
		});
	}
}
