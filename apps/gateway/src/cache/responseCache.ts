import type { Usage } from "#core/usage.ts";
import { redis } from "./redis.ts";

/** Cached entry: the body rendered to the client + the original usage (for the log). */
export interface CachedEntry {
	body: unknown;
	usage: Usage;
}

/** Cache configuration derived from the request headers. */
export interface CacheConfig {
	enabled: boolean;
	ttlSeconds: number;
}

const DEFAULT_TTL = 300;
const MAX_TTL = 86_400;
/**
 * Size cap of the cached value. Larger responses (typically large embedding batches, tens of MB of
 * vectors) are NOT cached: the per-hit saving does not justify the Redis memory or the cost of
 * serializing on every miss, and they rarely repeat identically. It amply covers the cases that are
 * worth it (a single embedding, normal chat completions).
 */
const MAX_VALUE_BYTES = 512 * 1024;
const CACHE_EPOCH_KEY = "cache:epoch:v1";

/** Global logical generation that makes invalidation safe against concurrent cache writes. */
export async function responseCacheEpoch(): Promise<string> {
	return (await redis.get(CACHE_EPOCH_KEY)) ?? "0";
}

export async function advanceResponseCacheEpoch(): Promise<string> {
	return String(await redis.incr(CACHE_EPOCH_KEY));
}

/** Reads the cache config from the x-unified-cache / x-unified-cache-ttl headers. */
export function cacheConfigFromHeaders(
	get: (name: string) => string | undefined,
): CacheConfig {
	const flag = get("x-unified-cache");
	const enabled = flag === "true" || flag === "1";
	const ttlRaw = Number(get("x-unified-cache-ttl"));
	const ttlSeconds =
		Number.isFinite(ttlRaw) && ttlRaw > 0
			? Math.min(ttlRaw, MAX_TTL)
			: DEFAULT_TTL;
	return { enabled, ttlSeconds };
}

export async function cacheGet(key: string): Promise<CachedEntry | null> {
	const raw = await redis.get(key);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as CachedEntry;
	} catch {
		return null;
	}
}

export async function cacheSet(
	key: string,
	entry: CachedEntry,
	ttlSeconds: number,
): Promise<void> {
	const payload = JSON.stringify(entry);
	// Best-effort: an oversized entry is silently skipped (serving without cache is not an error).
	if (Buffer.byteLength(payload, "utf8") > MAX_VALUE_BYTES) return;
	await redis.set(key, payload, "EX", ttlSeconds);
}

export interface CacheInvalidationOptions {
	callType?: string;
	namespace?: string;
}

function cachePattern(options: CacheInvalidationOptions): string {
	const callType = options.callType ?? "*";
	const namespace = options.namespace ?? "*";
	return `cache:${callType}:${namespace}:*`;
}

export async function invalidateResponseCache(
	options: CacheInvalidationOptions = {},
): Promise<number> {
	const pattern = cachePattern(options);
	let cursor = "0";
	let deleted = 0;
	do {
		const [next, keys] = await redis.scan(
			cursor,
			"MATCH",
			pattern,
			"COUNT",
			500,
		);
		cursor = next;
		if (keys.length > 0) {
			deleted += await redis.del(...keys);
		}
	} while (cursor !== "0");
	return deleted;
}
