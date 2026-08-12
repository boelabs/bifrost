import type { VirtualKeyAuth } from "./types.ts";
import { redis } from "#cache/redis.ts";

import {
	getVirtualKeyByHash,
	type VirtualKeyRow,
	hashVirtualKey,
} from "#db/repos/virtualKeys.ts";

const POSITIVE_TTL = 60; // s
const NEGATIVE_TTL = 10; // s (avoids hammering the DB with invalid keys, but short)

function cacheKey(hash: string): string {
	return `vk:${hash}`;
}

function toAuth(row: VirtualKeyRow): VirtualKeyAuth {
	return {
		id: row.id,
		name: row.name,
		allowedModels: row.allowedModels,
		enabled: row.enabled,
		expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
		maxBudgetCents: row.maxBudgetCents,
		budgetReset: row.budgetReset,
		budgetResetAt: row.budgetResetAt ? row.budgetResetAt.toISOString() : null,
		spendCents: Number(row.spendCents),
		tpm: row.tpm,
		rpm: row.rpm,
	};
}

/** Virtual key lookup by its plaintext value, cached in Redis (positive and negative). */
export async function getCachedVirtualKey(
	rawKey: string,
): Promise<VirtualKeyAuth | null> {
	const hash = hashVirtualKey(rawKey);
	const ck = cacheKey(hash);

	const cached = await redis.get(ck);
	if (cached !== null) {
		return cached === "null" ? null : (JSON.parse(cached) as VirtualKeyAuth);
	}

	const row = await getVirtualKeyByHash(hash);
	const info = row ? toAuth(row) : null;
	await redis.set(
		ck,
		info ? JSON.stringify(info) : "null",
		"EX",
		info ? POSITIVE_TTL : NEGATIVE_TTL,
	);
	return info;
}

/** Invalidates a key's cache by its hash (after update/delete in admin). */
export async function invalidateVirtualKey(hash: string): Promise<void> {
	await redis.del(cacheKey(hash));
}
