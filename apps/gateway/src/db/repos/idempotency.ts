import { type EncEnvelope, decryptJson, encryptJson } from "#db/crypto.ts";
import { idempotencyKeys } from "#db/schema.ts";
import { and, eq, lt } from "drizzle-orm";
import { db } from "#db/client.ts";

export type IdempotencyRow = typeof idempotencyKeys.$inferSelect;

export const IDEMPOTENCY_PURPOSE = "idempotency-response";

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
	const [row] = existing;
	// The row can disappear between the conflict and this read (expiry GC): treat that as a fresh
	// claim rather than failing a request that has done nothing wrong.
	if (!row) {
		return claimIdempotencyKey(input);
	}
	return { claimed: false, existing: row };
}

/**
 * Remembers the response to replay, encrypted.
 *
 * A response can carry a secret — creating or rotating a virtual key returns its plaintext — and this
 * table keeps it for a day. Sealing every response with the keyring, rather than only the ones known
 * to hold a secret, means a new route that returns one is covered without anyone remembering to opt
 * it in. An empty body stays NULL: there is nothing to protect.
 */
export async function completeIdempotencyKey(
	actor: string,
	key: string,
	status: number,
	response: unknown,
): Promise<void> {
	await db
		.update(idempotencyKeys)
		.set({
			status,
			response:
				response === null ? null : encryptJson(response, IDEMPOTENCY_PURPOSE),
			completedAt: new Date(),
		})
		.where(and(eq(idempotencyKeys.actor, actor), eq(idempotencyKeys.key, key)));
}

export type StoredResponse =
	| { readable: true; body: unknown }
	/** Sealed with a key the keyring no longer has. */
	| { readable: false };

/**
 * The body a completed row replays.
 *
 * A row written before responses were encrypted holds its body as plain JSON. Rows expire after
 * IDEMPOTENCY_TTL_MS (a day), so that branch only matters for the first day after upgrading and can
 * go in the release after. An admin response is always `{ data }` or empty, so it is never mistaken
 * for an envelope.
 */
export function storedResponse(row: IdempotencyRow): StoredResponse {
	const { response } = row;
	if (!isSealed(response)) {
		return { readable: true, body: response ?? null };
	}
	try {
		return { readable: true, body: decryptJson(response, IDEMPOTENCY_PURPOSE) };
	} catch {
		return { readable: false };
	}
}

function isSealed(value: unknown): value is EncEnvelope {
	return (
		value !== null &&
		typeof value === "object" &&
		(value as Partial<EncEnvelope>).v === 2 &&
		(value as Partial<EncEnvelope>).purpose === IDEMPOTENCY_PURPOSE
	);
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
