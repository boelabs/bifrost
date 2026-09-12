import { createHash } from "node:crypto";

/**
 * Canonical serialization (sorted keys) so equivalent requests produce the same cache key regardless
 * of property order.
 */
export function canonicalStringify(v: unknown): string {
	if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
	if (Array.isArray(v)) return `[${v.map(canonicalStringify).join(",")}]`;
	const obj = v as Record<string, unknown>;
	const keys = Object.keys(obj).sort();
	return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`).join(",")}}`;
}

/**
 * Cache key. The `namespace` (virtual key id or "master") ISOLATES per tenant so one key cannot read
 * responses cached by another.
 */
export function buildCacheKey(
	callType: string,
	namespace: string,
	payload: unknown,
): string {
	const hash = createHash("sha256")
		.update(canonicalStringify(payload))
		.digest("hex");
	return `cache:${callType}:${namespace}:${hash}`;
}

/** Removes volatile fields from the payload before hashing (they do not affect the result). */
export function cachePayload(
	req: Record<string, unknown>,
): Record<string, unknown> {
	const { stream: _s, stream_options: _so, ...rest } = req;
	return rest;
}
