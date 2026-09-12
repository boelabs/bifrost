import { getDashboardSettings } from "#db/repos/dashboardSettings.ts";
import { GatewayError } from "#core/errors.ts";
import { redis } from "#cache/redis.ts";

/**
 * Failed-login lockout. Counted per username AND per client IP: the username counter stops an attack
 * on one account from many addresses, the IP counter stops one address spraying many usernames.
 *
 * This is deliberately separate from `ratelimit/`, which meters paid inference against a virtual key
 * and reconciles token spend afterwards. Nothing here is metered or reconciled — it just counts.
 */
const WINDOW_PREFIX = "login-fail";

function keys(username: string, ip: string | null): string[] {
	const list = [`${WINDOW_PREFIX}:u:${username.toLowerCase()}`];
	if (ip) list.push(`${WINDOW_PREFIX}:i:${ip}`);
	return list;
}

async function lockoutSeconds(): Promise<number> {
	const { loginLockoutMinutes } = await getDashboardSettings();
	return loginLockoutMinutes * 60;
}

/** Throws 429 when either counter is already at the limit. Call before verifying credentials. */
export async function assertLoginAllowed(
	username: string,
	ip: string | null,
): Promise<void> {
	const counters = keys(username, ip);
	const { loginMaxAttempts } = await getDashboardSettings();
	const values = await redis.mget(...counters);
	const locked = values.some(
		(value) => value !== null && Number(value) >= loginMaxAttempts,
	);
	if (!locked) return;
	throw new GatewayError({
		class: "rate_limit",
		code: "login_locked_out",
		message: `Too many failed login attempts for "${username}"`,
		publicMessage: "Too many failed login attempts. Try again later.",
		headers: { "retry-after": String(await lockoutSeconds()) },
	});
}

/**
 * Records a failure. The expiry is set on first increment only, making this a fixed window: the
 * lockout ends a known time after the first failure rather than sliding forever under attack.
 */
export async function recordLoginFailure(
	username: string,
	ip: string | null,
): Promise<void> {
	const ttl = await lockoutSeconds();
	const pipeline = redis.pipeline();
	for (const key of keys(username, ip)) {
		pipeline.incr(key);
		pipeline.expire(key, ttl, "NX");
	}
	await pipeline.exec();
}

/** Clears both counters after a successful login. */
export async function clearLoginFailures(
	username: string,
	ip: string | null,
): Promise<void> {
	await redis.del(...keys(username, ip));
}
