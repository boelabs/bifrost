import { getDashboardSettings } from "#db/repos/dashboardSettings.ts";
import { getDashboardUserById } from "#db/repos/dashboardUsers.ts";
import type { DashboardRole } from "./roles.ts";
import type { SessionAuth } from "./types.ts";
import { generateToken } from "./password.ts";
import { redis } from "#cache/redis.ts";

import {
	revokeDashboardSession,
	createDashboardSession,
	touchDashboardSession,
	getLiveSessionByHash,
	hashSessionToken,
} from "#db/repos/dashboardSessions.ts";

/** Bounds how stale a cached session may be when it was revoked without going through this process. */
const CACHE_TTL_SECONDS = 30;
/** `lastSeenAt` is only written when it is at least this old, so idle tracking is not a write per request. */
const TOUCH_INTERVAL_MS = 60_000;

export const SESSION_COOKIE = "bifrost_session";
export const CSRF_COOKIE = "bifrost_csrf";
export const CSRF_HEADER = "x-csrf-token";

function cacheKey(hash: string): string {
	return `ds:${hash}`;
}

interface CachedSession {
	sessionId: string;
	userId: string | null;
	role: DashboardRole;
	/** Epoch ms. */
	expiresAt: number;
	/** Epoch ms. */
	lastSeenAt: number;
}

async function isIdle(lastSeenAt: number): Promise<boolean> {
	const { sessionIdleMinutes } = await getDashboardSettings();
	return Date.now() - lastSeenAt > sessionIdleMinutes * 60_000;
}

export interface IssuedSession {
	token: string;
	csrfToken: string;
	expiresAt: Date;
}

/** Mints a session for an authenticated identity. `userId` is null for the environment-backed root. */
export async function issueSession(opts: {
	userId: string | null;
	role: DashboardRole;
	ip: string | null;
	userAgent: string | null;
}): Promise<IssuedSession> {
	const token = generateToken();
	const { sessionTtlMinutes } = await getDashboardSettings();
	const expiresAt = new Date(Date.now() + sessionTtlMinutes * 60_000);
	await createDashboardSession({
		tokenHash: hashSessionToken(token),
		userId: opts.userId,
		role: opts.role,
		expiresAt,
		ip: opts.ip,
		userAgent: opts.userAgent,
	});
	return { token, csrfToken: generateToken(), expiresAt };
}

/**
 * Resolves a session token to an identity, or null when it is unknown, revoked, expired or idle.
 * Postgres stays the source of truth; Redis only removes the per-request lookup, with a TTL short
 * enough that a revocation performed by another replica takes effect within seconds even if its
 * cache invalidation never reached us.
 */
export async function resolveSession(
	token: string,
): Promise<SessionAuth | null> {
	const hash = hashSessionToken(token);
	const ck = cacheKey(hash);

	const cached = await redis.get(ck);
	if (cached !== null) {
		if (cached === "null") return null;
		const entry = JSON.parse(cached) as CachedSession;
		if (entry.expiresAt <= Date.now() || (await isIdle(entry.lastSeenAt))) {
			await redis.del(ck);
			return null;
		}
		return hydrate(entry);
	}

	const row = await getLiveSessionByHash(hash);
	if (!row || (await isIdle(row.lastSeenAt.getTime()))) {
		await redis.set(ck, "null", "EX", CACHE_TTL_SECONDS);
		return null;
	}

	// A user row can be disabled or deleted while sessions are live; the session must not outlive it.
	if (row.userId !== null) {
		const user = await getDashboardUserById(row.userId);
		if (!user?.enabled) {
			await revokeDashboardSession(row.id);
			await redis.set(ck, "null", "EX", CACHE_TTL_SECONDS);
			return null;
		}
	}

	const entry: CachedSession = {
		sessionId: row.id,
		userId: row.userId,
		role: row.role,
		expiresAt: row.expiresAt.getTime(),
		lastSeenAt: row.lastSeenAt.getTime(),
	};

	if (Date.now() - entry.lastSeenAt > TOUCH_INTERVAL_MS) {
		await touchDashboardSession(row.id);
		entry.lastSeenAt = Date.now();
	}

	await redis.set(ck, JSON.stringify(entry), "EX", CACHE_TTL_SECONDS);
	return hydrate(entry);
}

function hydrate(entry: CachedSession): SessionAuth {
	return {
		sessionId: entry.sessionId,
		userId: entry.userId,
		role: entry.role,
		isRoot: entry.userId === null,
	};
}

/** Revokes a single session and drops its cache entry immediately. */
export async function endSession(token: string): Promise<void> {
	const hash = hashSessionToken(token);
	const row = await getLiveSessionByHash(hash);
	if (row) await revokeDashboardSession(row.id);
	await redis.del(cacheKey(hash));
}

/** Drops cache entries for sessions revoked out of band (role change, disable, password reset). */
export async function invalidateSessionCaches(
	tokenHashes: readonly string[],
): Promise<void> {
	if (tokenHashes.length === 0) return;
	await redis.del(...tokenHashes.map(cacheKey));
}
