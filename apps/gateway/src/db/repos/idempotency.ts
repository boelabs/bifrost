import { idempotencyKeys } from "#db/schema.ts";
import { and, eq, lt } from "drizzle-orm";
import { db } from "#db/client.ts";

export type IdempotencyRow = typeof idempotencyKeys.$inferSelect;

export interface ClaimInput {
	actor: string;
	key: string;
	method: string;
	path: string;
	fingerprint: string;
	expiresAt: Date;
}

/**
 * Takes the key, or reports who already has it.
 *
 * The unique index on (actor, key) is the lock: two concurrent requests with the same key both try to
 * insert, exactly one wins, and the loser gets the winner's row back — still in flight, or already
 * carrying the response to replay. Nothing here needs an advisory lock or a transaction.
 */
export async function claimIdempotencyKey(
	input: ClaimInput,
): Promise<{ claimed: true } | { claimed: false; existing: IdempotencyRow }> {
	const inserted = await db
		.insert(idempotencyKeys)
		.values(input)
		.onConflictDoNothing({
			target: [idempotencyKeys.actor, idempotencyKeys.key],
		})
		.returning();
	if (inserted.length > 0) {
		return { claimed: true };
	}

	const existing = await db
		.select()
		.from(idempotencyKeys)
		.where(
			and(
				eq(idempotencyKeys.actor, input.actor),
				eq(idempotencyKeys.key, input.key),
			),
		)
		.limit(1);
	const row = existing[0];
	// The row can disappear between the conflict and this read (expiry GC): treat that as a fresh
	// claim rather than failing a request that has done nothing wrong.
	if (!row) {
		return claimIdempotencyKey(input);
	}
	return { claimed: false, existing: row };
}

export async function completeIdempotencyKey(
	actor: string,
	key: string,
	status: number,
	response: unknown,
): Promise<void> {
	await db
		.update(idempotencyKeys)
		.set({ status, response, completedAt: new Date() })
		.where(and(eq(idempotencyKeys.actor, actor), eq(idempotencyKeys.key, key)));
}

/**
 * Gives the key back after a failed call.
 *
 * A 500 or a 400 is not an outcome worth replaying — the operator will fix the body or the gateway
 * will recover — and holding the key would turn one failure into a permanent one.
 */
export async function releaseIdempotencyKey(
	actor: string,
	key: string,
): Promise<void> {
	await db
		.delete(idempotencyKeys)
		.where(and(eq(idempotencyKeys.actor, actor), eq(idempotencyKeys.key, key)));
}

export async function purgeExpiredIdempotencyKeys(
	now: Date = new Date(),
): Promise<number> {
	const deleted = await db
		.delete(idempotencyKeys)
		.where(lt(idempotencyKeys.expiresAt, now))
		.returning({ id: idempotencyKeys.id });
	return deleted.length;
}
