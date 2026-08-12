import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { responseStates } from "#db/schema.ts";
import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";
import { db } from "#db/client.ts";

export type ResponseStateRow = typeof responseStates.$inferSelect;

export interface StoreResponseStateInput {
	id: string;
	virtualKeyId: string | null;
	publicModel: string;
	deploymentId: string | null;
	adapterKey: string | null;
	previousResponseId: string | null;
	store?: boolean;
	requestInput: Record<string, unknown>[];
	output: Record<string, unknown>[];
	response: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

function responseStateExpiresAt(now = new Date()): Date {
	return new Date(
		now.getTime() + env.RESPONSES_STATE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
	);
}

export async function deleteExpiredResponseStates(
	now = new Date(),
): Promise<number> {
	const rows = await db
		.delete(responseStates)
		.where(lte(responseStates.expiresAt, now))
		.returning({ id: responseStates.id });
	return rows.length;
}

// Opportunistic prune (best-effort, tied to having write traffic and throttled in memory per
// instance): it only covers the gaps between ticks of the reliable, traffic-independent GC job
// (startResponseStateGcJob, wired in src/index.ts).
async function pruneExpiredOccasionally(): Promise<void> {
	const now = Date.now();
	if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
	lastPruneAt = now;
	await deleteExpiredResponseStates(new Date());
}

/**
 * Reliable, traffic-independent GC: deletes expired response_states on a fixed interval (mirrors the
 * other in-process maintenance jobs). Runs once on start, then every RESPONSE_STATE_GC_INTERVAL_MS;
 * opportunistic prune above still covers the gaps between ticks. Returns a stop function.
 */
export function startResponseStateGcJob(): () => void {
	const run = (): void => {
		void deleteExpiredResponseStates(new Date())
			.then((deleted) => {
				if (deleted > 0)
					log.info("response-states", "gc deleted expired rows", { deleted });
			})
			.catch((err: unknown) => {
				log.error("response-states", "gc failed", { err });
			});
	};
	run();
	const timer = setInterval(run, env.RESPONSE_STATE_GC_INTERVAL_MS);
	timer.unref();
	return () => clearInterval(timer);
}

export async function storeResponseState(
	input: StoreResponseStateInput,
): Promise<ResponseStateRow> {
	await pruneExpiredOccasionally();
	const [row] = await db
		.insert(responseStates)
		.values({
			id: input.id,
			virtualKeyId: input.virtualKeyId,
			publicModel: input.publicModel,
			deploymentId: input.deploymentId,
			adapterKey: input.adapterKey,
			previousResponseId: input.previousResponseId,
			store: input.store ?? true,
			requestInput: input.requestInput,
			output: input.output,
			response: input.response,
			metadata: input.metadata ?? {},
			expiresAt: responseStateExpiresAt(),
		})
		.returning();
	return row!;
}

export async function getResponseStateForScope(
	id: string,
	virtualKeyId: string | null,
	now = new Date(),
): Promise<ResponseStateRow | undefined> {
	const scope =
		virtualKeyId === null
			? isNull(responseStates.virtualKeyId)
			: eq(responseStates.virtualKeyId, virtualKeyId);
	const [row] = await db
		.select()
		.from(responseStates)
		.where(
			and(
				eq(responseStates.id, id),
				scope,
				eq(responseStates.store, true),
				gt(responseStates.expiresAt, now),
			),
		)
		.limit(1);
	return row;
}

/**
 * Find a single stored response *item* by its id, within the key's scope. Faithful to OpenAI: an
 * `item_reference` may point to ANY stored item (when store=true), not only items chained via
 * `previous_response_id`. Searches both the stored output and the (already-expanded) request input.
 *
 * Rows are narrowed by the indexed `virtual_key_id` + `expires_at`; the jsonb containment recheck
 * then runs over that (typically small) set. If a single key accumulates a very large number of
 * stored states, add an expression GIN index over the item ids.
 */
export async function findResponseItemByIdForScope(
	itemId: string,
	virtualKeyId: string | null,
	now = new Date(),
): Promise<Record<string, unknown> | undefined> {
	const scope =
		virtualKeyId === null
			? isNull(responseStates.virtualKeyId)
			: eq(responseStates.virtualKeyId, virtualKeyId);
	const needle = JSON.stringify([{ id: itemId }]);
	const [row] = await db
		.select({
			output: responseStates.output,
			requestInput: responseStates.requestInput,
		})
		.from(responseStates)
		.where(
			and(
				scope,
				eq(responseStates.store, true),
				gt(responseStates.expiresAt, now),
				sql`(${responseStates.output} @> ${needle}::jsonb OR ${responseStates.requestInput} @> ${needle}::jsonb)`,
			),
		)
		.limit(1);
	if (!row) return undefined;
	return [...row.output, ...row.requestInput].find(
		(it) => (it as { id?: unknown }).id === itemId,
	);
}

/** Deletes a state within the key's scope. Returns true if it existed and was deleted. */
export async function deleteResponseStateForScope(
	id: string,
	virtualKeyId: string | null,
): Promise<boolean> {
	const scope =
		virtualKeyId === null
			? isNull(responseStates.virtualKeyId)
			: eq(responseStates.virtualKeyId, virtualKeyId);
	const rows = await db
		.delete(responseStates)
		.where(
			and(eq(responseStates.id, id), scope, eq(responseStates.store, true)),
		)
		.returning({ id: responseStates.id });
	return rows.length > 0;
}
