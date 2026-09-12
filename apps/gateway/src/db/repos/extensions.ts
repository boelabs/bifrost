import { decryptString, encryptJson } from "#db/crypto.ts";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "#db/client.ts";

import {
	extensionArtifacts,
	extensionInstances,
	extensionRegistry,
} from "#db/schema.ts";

export type ExtensionArtifactRow = typeof extensionArtifacts.$inferSelect;
export type ExtensionInstanceRow = typeof extensionInstances.$inferSelect;

/** Artifact view without the (encrypted) code blob, for listing through the admin API. */
export type ExtensionArtifactSummary = Omit<ExtensionArtifactRow, "code">;

function toSummary(row: ExtensionArtifactRow): ExtensionArtifactSummary {
	const { code: _omit, ...rest } = row;
	return rest;
}

/* ------------------------------------------------------------- registry */

/** Current registry version; 0 when the singleton row does not exist yet. */
export async function getRegistryVersion(): Promise<number> {
	const [row] = await db
		.select({ version: extensionRegistry.version })
		.from(extensionRegistry)
		.where(eq(extensionRegistry.id, 1))
		.limit(1);
	return row?.version ?? 0;
}

/** Atomically increments (or seeds) the registry version. Returns the new value. */
export async function bumpRegistryVersion(): Promise<number> {
	const [row] = await db
		.insert(extensionRegistry)
		.values({ id: 1, version: 1 })
		.onConflictDoUpdate({
			target: extensionRegistry.id,
			set: {
				version: sql`${extensionRegistry.version} + 1`,
				updatedAt: new Date(),
			},
		})
		.returning({ version: extensionRegistry.version });
	return row!.version;
}

/* ------------------------------------------------------------- artifacts */

/** Active artifacts (one per key), with the decrypted module source. Used by the loader. */
export async function listActiveArtifactsWithCode(): Promise<
	Array<{ key: string; version: number; contentHash: string; code: string }>
> {
	const rows = await db
		.select()
		.from(extensionArtifacts)
		.where(eq(extensionArtifacts.status, "active"));
	return rows.map((row) => ({
		key: row.key,
		version: row.version,
		contentHash: row.contentHash,
		code: decryptString(row.code, "extension-source"),
	}));
}

export async function listArtifactSummaries(): Promise<
	ExtensionArtifactSummary[]
> {
	const rows = await db
		.select()
		.from(extensionArtifacts)
		.orderBy(extensionArtifacts.key, desc(extensionArtifacts.version));
	return rows.map(toSummary);
}

export async function listArtifactVersionsForKey(
	key: string,
): Promise<ExtensionArtifactSummary[]> {
	const rows = await db
		.select()
		.from(extensionArtifacts)
		.where(eq(extensionArtifacts.key, key))
		.orderBy(desc(extensionArtifacts.version));
	return rows.map(toSummary);
}

export interface InsertArtifactInput {
	key: string;
	code: string;
	contentHash: string;
	sizeBytes: number;
	uploadedBy: string | null;
}

/**
 * Stores a new version for `key`, marks it active, and archives any previously active version — all in
 * one transaction. The new version is `max(version) + 1`.
 */
export async function insertActiveArtifact(
	input: InsertArtifactInput,
): Promise<ExtensionArtifactSummary> {
	return db.transaction(async (tx) => {
		const [latest] = await tx
			.select({ version: extensionArtifacts.version })
			.from(extensionArtifacts)
			.where(eq(extensionArtifacts.key, input.key))
			.orderBy(desc(extensionArtifacts.version))
			.limit(1);
		const nextVersion = (latest?.version ?? 0) + 1;

		await tx
			.update(extensionArtifacts)
			.set({ status: "archived" })
			.where(
				and(
					eq(extensionArtifacts.key, input.key),
					eq(extensionArtifacts.status, "active"),
				),
			);

		const [row] = await tx
			.insert(extensionArtifacts)
			.values({
				key: input.key,
				version: nextVersion,
				contentHash: input.contentHash,
				sizeBytes: input.sizeBytes,
				code: encryptJson(input.code, "extension-source"),
				status: "active",
				uploadedBy: input.uploadedBy,
			})
			.returning();
		return toSummary(row!);
	});
}

/**
 * Makes (key, version) the active artifact and archives the rest. Returns false if that version does
 * not exist.
 */
export async function activateArtifactVersion(
	key: string,
	version: number,
): Promise<boolean> {
	return db.transaction(async (tx) => {
		const [target] = await tx
			.select({ id: extensionArtifacts.id })
			.from(extensionArtifacts)
			.where(
				and(
					eq(extensionArtifacts.key, key),
					eq(extensionArtifacts.version, version),
				),
			)
			.limit(1);
		if (!target) return false;
		await tx
			.update(extensionArtifacts)
			.set({ status: "archived" })
			.where(
				and(
					eq(extensionArtifacts.key, key),
					eq(extensionArtifacts.status, "active"),
				),
			);
		await tx
			.update(extensionArtifacts)
			.set({ status: "active" })
			.where(eq(extensionArtifacts.id, target.id));
		return true;
	});
}

/** Deletes every version of `key`. Returns the number of rows removed. */
export async function deleteArtifactKey(key: string): Promise<number> {
	const rows = await db
		.delete(extensionArtifacts)
		.where(eq(extensionArtifacts.key, key))
		.returning({ id: extensionArtifacts.id });
	return rows.length;
}

/* ------------------------------------------------------------- instances */

export async function listInstances(): Promise<ExtensionInstanceRow[]> {
	return db
		.select()
		.from(extensionInstances)
		.orderBy(extensionInstances.priority, extensionInstances.id);
}

export async function getInstanceById(
	id: string,
): Promise<ExtensionInstanceRow | undefined> {
	const [row] = await db
		.select()
		.from(extensionInstances)
		.where(eq(extensionInstances.id, id))
		.limit(1);
	return row;
}

export interface UpsertInstanceInput {
	id: string;
	definitionKey: string;
	enabled?: boolean | undefined;
	critical?: boolean | null | undefined;
	priority?: number | undefined;
	match?: Record<string, unknown> | undefined;
	config?: unknown;
}

export async function insertInstance(
	input: UpsertInstanceInput,
): Promise<ExtensionInstanceRow> {
	const [row] = await db
		.insert(extensionInstances)
		.values({
			id: input.id,
			definitionKey: input.definitionKey,
			...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
			...(input.critical !== undefined ? { critical: input.critical } : {}),
			...(input.priority !== undefined ? { priority: input.priority } : {}),
			...(input.match !== undefined ? { match: input.match } : {}),
			...(input.config !== undefined ? { config: input.config } : {}),
		})
		.returning();
	return row!;
}

export interface PatchInstanceInput {
	definitionKey?: string | undefined;
	enabled?: boolean | undefined;
	critical?: boolean | null | undefined;
	priority?: number | undefined;
	match?: Record<string, unknown> | undefined;
	config?: unknown;
}

export async function updateInstance(
	id: string,
	patch: PatchInstanceInput,
): Promise<ExtensionInstanceRow | undefined> {
	const [row] = await db
		.update(extensionInstances)
		.set({
			...(patch.definitionKey !== undefined
				? { definitionKey: patch.definitionKey }
				: {}),
			...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
			...(patch.critical !== undefined ? { critical: patch.critical } : {}),
			...(patch.priority !== undefined ? { priority: patch.priority } : {}),
			...(patch.match !== undefined ? { match: patch.match } : {}),
			...(patch.config !== undefined ? { config: patch.config } : {}),
			updatedAt: new Date(),
		})
		.where(eq(extensionInstances.id, id))
		.returning();
	return row;
}

/** Deletes an instance. Returns true if it existed. */
export async function deleteInstance(id: string): Promise<boolean> {
	const rows = await db
		.delete(extensionInstances)
		.where(eq(extensionInstances.id, id))
		.returning({ id: extensionInstances.id });
	return rows.length > 0;
}
