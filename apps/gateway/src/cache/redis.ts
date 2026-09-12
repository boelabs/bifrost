import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";
import { Redis } from "ioredis";

/**
 * Shared Redis client for router state (cooldowns, in-flight, TPM/RPM), atomic rate limiting (Lua)
 * and the response cache.
 *
 * `rediss://` enables TLS. Self-signed certs (e.g. from Coolify) may not include the IP in their SAN,
 * so certificate verification is relaxed (rejectUnauthorized:false). On an internal network
 * (`redis://`) the connection is plaintext.
 */
const useTls = env.REDIS_URL.startsWith("rediss://");

export const redis = new Redis(env.REDIS_URL, {
	maxRetriesPerRequest: 3,
	...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
});

// ioredis emits 'error' on every connection failure; without a listener Node reports it as an
// "Unhandled error event". We log it at debug level (ioredis keeps retrying on its own).
redis.on("error", (err: Error) => {
	log.debug("redis", "connection error", { err });
});

/** Health ping. */
export async function pingRedis(): Promise<boolean> {
	try {
		const pong = await redis.ping();
		return pong === "PONG";
	} catch {
		return false;
	}
}

export async function closeRedis(): Promise<void> {
	try {
		await redis.quit();
	} catch {
		redis.disconnect();
	}
}
