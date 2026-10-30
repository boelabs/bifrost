import { createHash, randomBytes } from "node:crypto";
import { redis } from "#cache/redis.ts";

/**
 * Realtime client secrets (OpenAI's `POST /v1/realtime/client_secrets`): short-lived `ek_…` keys a
 * backend mints so a browser can open `/v1/realtime` without holding the real key. Redis keeps only
 * a hash of the value, which key minted it, and the session configuration attached to it.
 */

export const REALTIME_SECRET_PREFIX = "ek_";

export interface StoredRealtimeSecret {
	/** Hash of the virtual key that minted it; null for the master key. */
	keyHash: string | null;
	session: Record<string, unknown> | null;
	/** Unix seconds. */
	expiresAt: number;
}

function storageKey(value: string): string {
	return `rtsecret:${createHash("sha256").update(value).digest("hex")}`;
}

export async function mintRealtimeSecret(
	grant: Omit<StoredRealtimeSecret, "expiresAt">,
	seconds: number,
): Promise<{ value: string; expiresAt: number }> {
	const value = `${REALTIME_SECRET_PREFIX}${randomBytes(24).toString("base64url")}`;
	const expiresAt = Math.floor(Date.now() / 1000) + seconds;
	const stored: StoredRealtimeSecret = { ...grant, expiresAt };
	await redis.set(storageKey(value), JSON.stringify(stored), "EX", seconds);
	return { value, expiresAt };
}

/** The secret behind `value`, or null when it is unknown or expired. */
export async function resolveRealtimeSecret(
	value: string,
): Promise<StoredRealtimeSecret | null> {
	const raw = await redis.get(storageKey(value));
	if (raw === null) {
		return null;
	}
	const stored = JSON.parse(raw) as StoredRealtimeSecret;
	return stored.expiresAt > Date.now() / 1000 ? stored : null;
}
