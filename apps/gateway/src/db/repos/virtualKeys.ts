import type { Page, PageResult } from "./deployments.ts";
import { createHash, randomBytes } from "node:crypto";
import { nextResetAt } from "#ratelimit/period.ts";
import { virtualKeys } from "#db/schema.ts";
import { db } from "#db/client.ts";

import {
	sql as drizzleSql,
	type SQL,
	ilike,
	count,
	and,
	lte,
	eq,
	or,
} from "drizzle-orm";

export type VirtualKeyRow = typeof virtualKeys.$inferSelect;

export interface VirtualKeyListFilter {
	enabled?: boolean;
	/** Only keys that can use this public model (includes allowedModels=[]). */
	publicModel?: string;
	q?: string;
}

/** Lists virtual keys with filters + pagination in SQL. */
export async function listVirtualKeysPage(
	opts: Page & VirtualKeyListFilter,
): Promise<PageResult<VirtualKeyRow>> {
	const conds: SQL[] = [];
	if (opts.enabled !== undefined)
		conds.push(eq(virtualKeys.enabled, opts.enabled));
	if (opts.publicModel) {
		// allowedModels=[] means all; otherwise it must contain the public model.
		conds.push(
			drizzleSql`(${virtualKeys.allowedModels} = '{}' OR ${opts.publicModel} = ANY(${virtualKeys.allowedModels}))`,
		);
	}
	if (opts.q) {
		const like = `%${opts.q}%`;
		conds.push(
			or(ilike(virtualKeys.name, like), ilike(virtualKeys.keyPrefix, like))!,
		);
	}
	const where = conds.length > 0 ? and(...conds) : undefined;
	const [rows, totalRow] = await Promise.all([
		db
			.select()
			.from(virtualKeys)
			.where(where)
			.orderBy(virtualKeys.createdAt)
			.limit(opts.limit)
			.offset(opts.offset),
		db.select({ value: count() }).from(virtualKeys).where(where),
	]);
	return { rows, total: Number(totalRow[0]?.value ?? 0) };
}

export interface CreateVirtualKeyInput {
	name: string;
	/** Allowed public models. [] or absent = all. */
	allowedModels?: string[];
	maxBudgetCents?: number | null;
	budgetReset?: "hourly" | "daily" | "weekly" | "monthly" | null;
	budgetResetAt?: Date | null;
	tpm?: number | null;
	rpm?: number | null;
	expiresAt?: Date | null;
}

export interface CreatedVirtualKey {
	row: VirtualKeyRow;
	/** Plaintext key. Only returned here, on creation; not persisted. */
	rawKey: string;
}

export function hashVirtualKey(raw: string): string {
	return createHash("sha256").update(raw).digest("hex");
}

/** Generates a random "unified-..." key (url-safe). */
function generateRawKey(): string {
	return `unified-${randomBytes(24).toString("base64url")}`;
}

export async function createVirtualKey(
	input: CreateVirtualKeyInput,
): Promise<CreatedVirtualKey> {
	const rawKey = generateRawKey();
	const [row] = await db
		.insert(virtualKeys)
		.values({
			keyHash: hashVirtualKey(rawKey),
			keyPrefix: rawKey.slice(0, 10),
			name: input.name,
			allowedModels: input.allowedModels ?? [],
			maxBudgetCents: input.maxBudgetCents ?? null,
			budgetReset: input.budgetReset ?? null,
			budgetResetAt:
				input.budgetResetAt ?? nextResetAt(input.budgetReset ?? null),
			tpm: input.tpm ?? null,
			rpm: input.rpm ?? null,
			expiresAt: input.expiresAt ?? null,
		})
		.returning();
	return { row: row!, rawKey };
}

export async function getVirtualKeyByHash(
	hash: string,
): Promise<VirtualKeyRow | undefined> {
	const [row] = await db
		.select()
		.from(virtualKeys)
		.where(eq(virtualKeys.keyHash, hash))
		.limit(1);
	return row;
}

export async function getVirtualKeyByRaw(
	rawKey: string,
): Promise<VirtualKeyRow | undefined> {
	return getVirtualKeyByHash(hashVirtualKey(rawKey));
}

export async function getVirtualKeyById(
	id: string,
): Promise<VirtualKeyRow | undefined> {
	const [row] = await db
		.select()
		.from(virtualKeys)
		.where(eq(virtualKeys.id, id))
		.limit(1);
	return row;
}

export interface UpdateVirtualKeyInput {
	name?: string;
	allowedModels?: string[];
	maxBudgetCents?: number | null;
	budgetReset?: "hourly" | "daily" | "weekly" | "monthly" | null;
	budgetResetAt?: Date | null;
	tpm?: number | null;
	rpm?: number | null;
	enabled?: boolean;
	expiresAt?: Date | null;
	resetSpend?: boolean;
}

export async function updateVirtualKey(
	id: string,
	input: UpdateVirtualKeyInput,
): Promise<VirtualKeyRow | undefined> {
	const set: Partial<typeof virtualKeys.$inferInsert> = {
		updatedAt: new Date(),
	};
	if (input.name !== undefined) set.name = input.name;
	if (input.allowedModels !== undefined)
		set.allowedModels = input.allowedModels;
	if (input.maxBudgetCents !== undefined)
		set.maxBudgetCents = input.maxBudgetCents;
	if (input.budgetReset !== undefined) {
		set.budgetReset = input.budgetReset;
		set.budgetResetAt = input.budgetResetAt ?? nextResetAt(input.budgetReset);
	} else if (input.budgetResetAt !== undefined) {
		set.budgetResetAt = input.budgetResetAt;
	}
	if (input.tpm !== undefined) set.tpm = input.tpm;
	if (input.rpm !== undefined) set.rpm = input.rpm;
	if (input.enabled !== undefined) set.enabled = input.enabled;
	if (input.expiresAt !== undefined) set.expiresAt = input.expiresAt;
	if (input.resetSpend) set.spendCents = "0";

	const [row] = await db
		.update(virtualKeys)
		.set(set)
		.where(eq(virtualKeys.id, id))
		.returning();
	return row;
}

export async function addVirtualKeySpend(
	id: string,
	cents: number,
): Promise<void> {
	if (!(cents > 0)) return;
	await db
		.update(virtualKeys)
		.set({
			spendCents: drizzleSql`${virtualKeys.spendCents} + ${cents.toFixed(10)}`,
			updatedAt: new Date(),
		})
		.where(eq(virtualKeys.id, id));
}

export async function resetVirtualKeySpend(
	id: string,
	budgetReset: "hourly" | "daily" | "weekly" | "monthly" | null = null,
): Promise<void> {
	await db
		.update(virtualKeys)
		.set({
			spendCents: "0",
			budgetResetAt: nextResetAt(budgetReset),
			updatedAt: new Date(),
		})
		.where(eq(virtualKeys.id, id));
}

/** Lazily advances an expired budget window exactly once across all gateway replicas. */
export async function resetVirtualKeySpendIfDue(
	id: string,
	budgetReset: "hourly" | "daily" | "weekly" | "monthly" | null,
	now = new Date(),
): Promise<boolean> {
	if (budgetReset === null) return false;
	const rows = await db
		.update(virtualKeys)
		.set({
			spendCents: "0",
			budgetResetAt: nextResetAt(budgetReset, now),
			updatedAt: now,
		})
		.where(and(eq(virtualKeys.id, id), lte(virtualKeys.budgetResetAt, now)))
		.returning({ id: virtualKeys.id });
	return rows.length === 1;
}

export async function deleteVirtualKey(id: string): Promise<void> {
	await db.delete(virtualKeys).where(eq(virtualKeys.id, id));
}
