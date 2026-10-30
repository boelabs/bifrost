import { type EncEnvelope, encryptJson } from "#db/crypto.ts";
import type { Page, PageResult } from "./deployments.ts";
import { createHash, randomBytes } from "node:crypto";
import { nextResetAt } from "#ratelimit/period.ts";
import { writtenRow } from "#db/returning.ts";
import { virtualKeys } from "#db/schema.ts";
import { db } from "#db/client.ts";

import {
	sql as drizzleSql,
	getTableColumns,
	type SQL,
	ilike,
	count,
	and,
	lte,
	or,
	eq,
} from "drizzle-orm";

/**
 * Every column but the sealed secret, plus whether there is one.
 *
 * The envelope leaves this module only through `getVirtualKeySecret`: listing a page of keys, or
 * authenticating a request, never reads it, so no other code path can hand it to a caller by
 * accident and the hot path does not carry a few hundred bytes per key it has no use for.
 */
const { secret: _sealed, ...readableColumns } = getTableColumns(virtualKeys);
const columns = {
	...readableColumns,
	hasSecret: drizzleSql<boolean>`${virtualKeys.secret} IS NOT NULL`.as(
		"has_secret",
	),
};

export type VirtualKeyRow = Omit<typeof virtualKeys.$inferSelect, "secret"> & {
	/** False for a private key, whose plaintext was shown once and never stored. */
	hasSecret: boolean;
};

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
	if (opts.enabled !== undefined) {
		conds.push(eq(virtualKeys.enabled, opts.enabled));
	}
	if (opts.publicModel) {
		// allowedModels=[] means all; otherwise it must contain the public model.
		conds.push(
			drizzleSql`(${virtualKeys.allowedModels} = '{}' OR ${opts.publicModel} = ANY(${virtualKeys.allowedModels}))`,
		);
	}
	if (opts.q) {
		// Either field: a key is found by part of its name or by its prefix.
		const like = `%${opts.q}%`;
		const match = or(
			ilike(virtualKeys.name, like),
			ilike(virtualKeys.keyPrefix, like),
		);
		if (match) {
			conds.push(match);
		}
	}
	const where = conds.length > 0 ? and(...conds) : undefined;
	const [rows, totalRow] = await Promise.all([
		db
			.select(columns)
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
	/** Actor that created the key, for attribution in listings and the audit trail. */
	createdBy?: string;
	/** Allowed public models. [] or absent = all. */
	allowedModels?: string[];
	maxBudgetCents?: number | null;
	budgetReset?: "hourly" | "daily" | "weekly" | "monthly" | null;
	budgetResetAt?: Date | null;
	tpm?: number | null;
	rpm?: number | null;
	expiresAt?: Date | null;
	/** Never store the plaintext: the key is shown once and can only be regenerated. */
	private?: boolean;
}

export interface CreatedVirtualKey {
	row: VirtualKeyRow;
	/** Plaintext key. Persisted only encrypted, and only for a key that is not private. */
	rawKey: string;
}

export function hashVirtualKey(raw: string): string {
	return createHash("sha256").update(raw).digest("hex");
}

/**
 * Generates a random `sk-...` key (url-safe).
 *
 * `sk-` because every client library, secret scanner and developer already reads those two letters
 * as "this is a secret key, do not paste it anywhere". The gateway is OpenAI-shaped on the wire, and
 * its keys may as well be recognisable in the same way.
 *
 * Changing this is safe for keys already issued: a key is found by the SHA-256 of the whole string,
 * never by its prefix, so the old ones keep working untouched.
 */
function generateRawKey(): string {
	return `sk-${randomBytes(24).toString("base64url")}`;
}

/** The three columns that are the key itself; everything else about it survives a rotation. */
function keyMaterial(rawKey: string, keepSecret: boolean) {
	return {
		keyHash: hashVirtualKey(rawKey),
		keyPrefix: rawKey.slice(0, 10),
		secret: keepSecret ? sealSecret(rawKey) : null,
	};
}

function sealSecret(rawKey: string): EncEnvelope {
	return encryptJson(rawKey, "virtual-key-secret");
}

export async function createVirtualKey(
	input: CreateVirtualKeyInput,
): Promise<CreatedVirtualKey> {
	const rawKey = generateRawKey();
	const [row] = await db
		.insert(virtualKeys)
		.values({
			...keyMaterial(rawKey, input.private !== true),
			name: input.name,
			createdBy: input.createdBy ?? null,
			allowedModels: input.allowedModels ?? [],
			maxBudgetCents: input.maxBudgetCents ?? null,
			budgetReset: input.budgetReset ?? null,
			budgetResetAt:
				input.budgetResetAt ?? nextResetAt(input.budgetReset ?? null),
			tpm: input.tpm ?? null,
			rpm: input.rpm ?? null,
			expiresAt: input.expiresAt ?? null,
		})
		.returning(columns);
	return { row: writtenRow(row, "createVirtualKey"), rawKey };
}

export interface RotatedVirtualKey extends CreatedVirtualKey {
	/** The hash the old key authenticated with, for the caller to evict from every cache. */
	previousHash: string;
}

/**
 * Replaces a key's secret and keeps everything else: its id, limits, spend and history.
 *
 * The row is locked for the read-then-write, so two rotations racing each other each evict the hash
 * they actually replaced rather than both evicting the original one. `private` defaults to the
 * key's current setting: regenerating never starts storing a secret the operator chose not to keep.
 */
export async function rotateVirtualKey(
	id: string,
	options: { private?: boolean } = {},
): Promise<RotatedVirtualKey | undefined> {
	return await db.transaction(async (tx) => {
		const [current] = await tx
			.select({ keyHash: virtualKeys.keyHash, hasSecret: columns.hasSecret })
			.from(virtualKeys)
			.where(eq(virtualKeys.id, id))
			.for("update");
		if (!current) {
			return;
		}
		const rawKey = generateRawKey();
		const keepSecret =
			options.private === undefined ? current.hasSecret : !options.private;
		const [row] = await tx
			.update(virtualKeys)
			.set({ ...keyMaterial(rawKey, keepSecret), updatedAt: new Date() })
			.where(eq(virtualKeys.id, id))
			.returning(columns);
		return {
			row: writtenRow(row, "rotateVirtualKey"),
			rawKey,
			previousHash: current.keyHash,
		};
	});
}

/**
 * The sealed secret and the hash it must match, for the one route that reveals it. Nothing here
 * decrypts: whether this caller may see it is the route's decision, not the repository's.
 */
export async function getVirtualKeySecret(
	id: string,
): Promise<{ keyHash: string; secret: EncEnvelope | null } | undefined> {
	const [row] = await db
		.select({ keyHash: virtualKeys.keyHash, secret: virtualKeys.secret })
		.from(virtualKeys)
		.where(eq(virtualKeys.id, id))
		.limit(1);
	return row;
}

export async function getVirtualKeyByHash(
	hash: string,
): Promise<VirtualKeyRow | undefined> {
	const [row] = await db
		.select(columns)
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
		.select(columns)
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
	/** Erases the stored secret. One way: a private key becomes copyable only by rotating it. */
	private?: true;
}

export async function updateVirtualKey(
	id: string,
	input: UpdateVirtualKeyInput,
): Promise<VirtualKeyRow | undefined> {
	const set: Partial<typeof virtualKeys.$inferInsert> = {
		updatedAt: new Date(),
	};
	if (input.name !== undefined) {
		set.name = input.name;
	}
	if (input.allowedModels !== undefined) {
		set.allowedModels = input.allowedModels;
	}
	if (input.maxBudgetCents !== undefined) {
		set.maxBudgetCents = input.maxBudgetCents;
	}
	if (input.budgetReset !== undefined) {
		set.budgetReset = input.budgetReset;
		set.budgetResetAt = input.budgetResetAt ?? nextResetAt(input.budgetReset);
	} else if (input.budgetResetAt !== undefined) {
		set.budgetResetAt = input.budgetResetAt;
	}
	if (input.tpm !== undefined) {
		set.tpm = input.tpm;
	}
	if (input.rpm !== undefined) {
		set.rpm = input.rpm;
	}
	if (input.enabled !== undefined) {
		set.enabled = input.enabled;
	}
	if (input.expiresAt !== undefined) {
		set.expiresAt = input.expiresAt;
	}
	if (input.resetSpend) {
		set.spendCents = "0";
	}
	if (input.private) {
		set.secret = null;
	}

	const [row] = await db
		.update(virtualKeys)
		.set(set)
		.where(eq(virtualKeys.id, id))
		.returning(columns);
	return row;
}

export async function addVirtualKeySpend(
	id: string,
	cents: number,
): Promise<void> {
	if (!(cents > 0)) {
		return;
	}
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
	if (budgetReset === null) {
		return false;
	}
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
