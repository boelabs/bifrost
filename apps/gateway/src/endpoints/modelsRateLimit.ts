import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import { clientIp } from "./shared.ts";
import { env } from "#config/env.ts";
import type { Context } from "hono";

const WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 10_000;

export function createFixedWindowRateLimiter(
	limit: number,
	now: () => number = Date.now,
): (subject: string) => number | null {
	let windowStart = -1;
	const counts = new Map<string, number>();

	return (subject) => {
		const timestamp = now();
		const activeWindow = Math.floor(timestamp / WINDOW_MS) * WINDOW_MS;
		if (activeWindow !== windowStart) {
			windowStart = activeWindow;
			counts.clear();
		}
		const count = counts.get(subject) ?? 0;
		if (count >= limit) {
			return Math.max(
				1,
				Math.ceil((windowStart + WINDOW_MS - timestamp) / 1_000),
			);
		}
		if (!counts.has(subject) && counts.size >= MAX_TRACKED_CLIENTS) {
			const oldest = counts.keys().next().value;
			if (oldest !== undefined) counts.delete(oldest);
		}
		counts.set(subject, count + 1);
		return null;
	};
}

const consumePublicModelRequest = createFixedWindowRateLimiter(
	env.PUBLIC_MODELS_RPM,
);

/** Applies a deliberately generous abuse limit to anonymous model discovery. */
export function enforcePublicModelRateLimit(c: Context<AppEnv>): void {
	if (env.PUBLIC_MODELS_RPM === 0) return;
	const ip = clientIp(c);
	if (!ip) return;
	const retryAfter = consumePublicModelRequest(ip);
	if (retryAfter === null) return;
	throw new GatewayError({
		class: "rate_limit",
		code: "rate_limit_exceeded",
		message: "Public model discovery rate limit exceeded",
		publicMessage: "Too many model catalog requests. Please try again later.",
		headers: { "retry-after": String(retryAfter) },
	});
}
