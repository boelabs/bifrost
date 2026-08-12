import { eq, and, or, ilike, count, sql, type SQL } from "drizzle-orm";
import { fallbackPolicies, modelDeployments } from "#db/schema.ts";
import type { TransportOverrides } from "#profiles/types.ts";
import { decryptRecord, encryptJson } from "#db/crypto.ts";
import type { RuntimeModelMetadata } from "#db/schema.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import { db } from "#db/client.ts";

export interface DeploymentListFilter {
	enabled?: boolean;
	publicModel?: string;
	q?: string;
}

export interface Page {
	limit: number;
	offset: number;
}

export interface PageResult<T> {
	rows: T[];
	total: number;
}

/** Lists deployments with filters + pagination in SQL (LIMIT/OFFSET + count). */
export async function listDeploymentsPage(
	opts: Page & DeploymentListFilter,
): Promise<PageResult<DeploymentRow>> {
	const conds: SQL[] = [];
	if (opts.enabled !== undefined)
		conds.push(eq(modelDeployments.enabled, opts.enabled));
	if (opts.publicModel)
		conds.push(eq(modelDeployments.publicModel, opts.publicModel));
	if (opts.q) {
		const like = `%${opts.q}%`;
		conds.push(
			or(
				ilike(modelDeployments.publicModel, like),
				ilike(modelDeployments.upstreamModel, like),
			)!,
		);
	}
	const where = conds.length > 0 ? and(...conds) : undefined;
	const [rows, totalRow] = await Promise.all([
		db
			.select()
			.from(modelDeployments)
			.where(where)
			.orderBy(modelDeployments.createdAt)
			.limit(opts.limit)
			.offset(opts.offset),
		db.select({ value: count() }).from(modelDeployments).where(where),
	]);
	return { rows, total: Number(totalRow[0]?.value ?? 0) };
}

export interface CreateDeploymentInput {
	publicModel: string;
	adapterKey: string;
	upstreamModel: string;
	/** Plaintext credentials; encrypted before persistence. */
	credentials: Record<string, unknown>;
	/** Operator-facing label; null/absent leaves it unset. */
	label?: string | null;
	/** Optional shared provider account/quota domain; null keeps this deployment independent. */
	failureDomain?: string | null;
	/** Free-form operator annotations; absent defaults to {}. */
	metadata?: Record<string, unknown>;
	/** Inline CatalogEntry for custom models; null/absent for catalog models. */
	catalogEntry?: CatalogEntry | null;
	pricing?: RuntimeModelMetadata["pricing"] | null;
	transportOverrides?: TransportOverrides;
	enabled?: boolean;
	weight?: number;
	tpmLimit?: number | null;
	rpmLimit?: number | null;
}

export type DeploymentRow = typeof modelDeployments.$inferSelect;

export class PublicModelReferencedError extends Error {
	readonly publicModel: string;

	constructor(publicModel: string) {
		super(
			`Cannot rename the last deployment of referenced public model "${publicModel}"`,
		);
		this.name = "PublicModelReferencedError";
		this.publicModel = publicModel;
	}
}

export async function createDeployment(
	input: CreateDeploymentInput,
): Promise<DeploymentRow> {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${input.publicModel}))`,
		);
		const [row] = await tx
			.insert(modelDeployments)
			.values({
				publicModel: input.publicModel,
				adapterKey: input.adapterKey,
				upstreamModel: input.upstreamModel,
				credentials: encryptJson(input.credentials, "deployment-credentials"),
				label: input.label ?? null,
				failureDomain: input.failureDomain ?? null,
				metadata: input.metadata ?? {},
				catalogEntry: input.catalogEntry ?? null,
				pricing: input.pricing ?? null,
				transportOverrides: input.transportOverrides ?? {},
				enabled: input.enabled ?? true,
				weight: input.weight ?? 1,
				tpmLimit: input.tpmLimit ?? null,
				rpmLimit: input.rpmLimit ?? null,
			})
			.returning();
		return row!;
	});
}

export interface UpdateDeploymentInput {
	publicModel?: string;
	upstreamModel?: string;
	/** Plaintext credentials; re-encrypted. */
	credentials?: Record<string, unknown>;
	/** Operator label; null clears it. */
	label?: string | null;
	failureDomain?: string | null;
	/** Free-form operator annotations; replaces the stored object. */
	metadata?: Record<string, unknown>;
	catalogEntry?: CatalogEntry | null;
	pricing?: RuntimeModelMetadata["pricing"] | null;
	transportOverrides?: TransportOverrides;
	enabled?: boolean;
	weight?: number;
	tpmLimit?: number | null;
	rpmLimit?: number | null;
}

/** Partially updates a deployment. Returns the new row, or undefined if it does not exist. */
export async function updateDeployment(
	id: string,
	input: UpdateDeploymentInput,
): Promise<DeploymentRow | undefined> {
	const set: Partial<typeof modelDeployments.$inferInsert> = {
		updatedAt: new Date(),
	};
	if (input.publicModel !== undefined) set.publicModel = input.publicModel;
	if (input.upstreamModel !== undefined)
		set.upstreamModel = input.upstreamModel;
	if (input.credentials !== undefined)
		set.credentials = encryptJson(input.credentials, "deployment-credentials");
	if (input.label !== undefined) set.label = input.label;
	if (input.failureDomain !== undefined)
		set.failureDomain = input.failureDomain;
	if (input.metadata !== undefined) set.metadata = input.metadata;
	if (input.catalogEntry !== undefined) set.catalogEntry = input.catalogEntry;
	if (input.pricing !== undefined) set.pricing = input.pricing;
	if (input.transportOverrides !== undefined)
		set.transportOverrides = input.transportOverrides;
	if (input.enabled !== undefined) set.enabled = input.enabled;
	if (input.weight !== undefined) set.weight = input.weight;
	if (input.tpmLimit !== undefined) set.tpmLimit = input.tpmLimit;
	if (input.rpmLimit !== undefined) set.rpmLimit = input.rpmLimit;
	return db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ publicModel: modelDeployments.publicModel })
			.from(modelDeployments)
			.where(eq(modelDeployments.id, id))
			.limit(1);
		if (!existing) return undefined;

		const nextPublicModel = input.publicModel ?? existing.publicModel;
		const publicModelsToLock = [
			...new Set([existing.publicModel, nextPublicModel]),
		].sort();
		for (const publicModel of publicModelsToLock) {
			await tx.execute(
				sql`SELECT pg_advisory_xact_lock(hashtext(${publicModel}))`,
			);
		}

		if (nextPublicModel !== existing.publicModel) {
			const [deploymentCount] = await tx
				.select({ value: count() })
				.from(modelDeployments)
				.where(eq(modelDeployments.publicModel, existing.publicModel));
			if (Number(deploymentCount?.value ?? 0) === 1) {
				const [reference] = await tx
					.select({ id: fallbackPolicies.id })
					.from(fallbackPolicies)
					.where(
						or(
							eq(fallbackPolicies.primaryModel, existing.publicModel),
							sql`${existing.publicModel} = ANY(${fallbackPolicies.fallbackModels})`,
						),
					)
					.limit(1);
				if (reference)
					throw new PublicModelReferencedError(existing.publicModel);
			}
		}

		const [row] = await tx
			.update(modelDeployments)
			.set(set)
			.where(eq(modelDeployments.id, id))
			.returning();
		return row;
	});
}

export async function getDeploymentById(
	id: string,
): Promise<DeploymentRow | undefined> {
	const [row] = await db
		.select()
		.from(modelDeployments)
		.where(eq(modelDeployments.id, id))
		.limit(1);
	return row;
}

/** Deployments of a public name (only enabled by default). */
export async function listDeploymentsByPublicModel(
	publicModel: string,
	opts: { includeDisabled?: boolean } = {},
): Promise<DeploymentRow[]> {
	const where = opts.includeDisabled
		? eq(modelDeployments.publicModel, publicModel)
		: and(
				eq(modelDeployments.publicModel, publicModel),
				eq(modelDeployments.enabled, true),
			);
	return db.select().from(modelDeployments).where(where);
}

/** All enabled deployments, used for public model discovery. */
export async function listEnabledDeployments(): Promise<DeploymentRow[]> {
	return db
		.select()
		.from(modelDeployments)
		.where(eq(modelDeployments.enabled, true))
		.orderBy(modelDeployments.createdAt);
}

/** Enabled public models, derived from public_model, with their oldest deployment. */
export async function listPublicModels(): Promise<
	Array<{ name: string; createdAt: Date }>
> {
	const rows = await db
		.select({
			name: modelDeployments.publicModel,
			createdAt: modelDeployments.createdAt,
		})
		.from(modelDeployments)
		.where(eq(modelDeployments.enabled, true));
	const earliest = new Map<string, Date>();
	for (const r of rows) {
		const prev = earliest.get(r.name);
		if (!prev || r.createdAt < prev) earliest.set(r.name, r.createdAt);
	}
	return [...earliest.entries()].map(([name, createdAt]) => ({
		name,
		createdAt,
	}));
}

/** Returns a deployment's decrypted credentials. */
export async function getDeploymentCredentials(
	id: string,
): Promise<Record<string, unknown> | undefined> {
	const row = await getDeploymentById(id);
	if (!row) return undefined;
	return decryptRecord(row.credentials, "deployment-credentials");
}

export async function deleteDeployment(id: string): Promise<void> {
	await db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ publicModel: modelDeployments.publicModel })
			.from(modelDeployments)
			.where(eq(modelDeployments.id, id))
			.limit(1);
		if (!existing) return;

		await tx.execute(
			sql`SELECT pg_advisory_xact_lock(hashtext(${existing.publicModel}))`,
		);
		await tx.delete(modelDeployments).where(eq(modelDeployments.id, id));

		const [remaining] = await tx
			.select({ value: count() })
			.from(modelDeployments)
			.where(eq(modelDeployments.publicModel, existing.publicModel));
		if (Number(remaining?.value ?? 0) > 0) return;

		for (const fallback of await tx.select().from(fallbackPolicies)) {
			if (fallback.primaryModel === existing.publicModel) {
				await tx
					.delete(fallbackPolicies)
					.where(eq(fallbackPolicies.id, fallback.id));
				continue;
			}
			const fallbackModels = fallback.fallbackModels.filter(
				(publicModel) => publicModel !== existing.publicModel,
			);
			if (fallbackModels.length === fallback.fallbackModels.length) continue;
			if (fallbackModels.length === 0) {
				await tx
					.delete(fallbackPolicies)
					.where(eq(fallbackPolicies.id, fallback.id));
			} else {
				await tx
					.update(fallbackPolicies)
					.set({ fallbackModels })
					.where(eq(fallbackPolicies.id, fallback.id));
			}
		}
	});
}
