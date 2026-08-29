import { listEnabledDeployments } from "#db/repos/deployments.ts";
import type { DeploymentRow } from "#db/repos/deployments.ts";
import { createAsyncTtlCache } from "#core/asyncTtlCache.ts";
import type { ResolvedModelMetadata } from "./types.ts";
import { resolveModelMetadata } from "./index.ts";

export interface PublicModelGroup {
	name: string;
	createdAt: Date;
	rows: DeploymentRow[];
	metas: ResolvedModelMetadata[];
}

async function loadGroups(): Promise<Map<string, PublicModelGroup>> {
	const groups = new Map<string, PublicModelGroup>();
	for (const row of await listEnabledDeployments()) {
		const meta = resolveModelMetadata(
			row.adapterKey,
			row.upstreamModel,
			row.catalogEntry,
			row.pricing,
		);
		const existing = groups.get(row.publicModel);
		if (!existing) {
			groups.set(row.publicModel, {
				name: row.publicModel,
				createdAt: row.createdAt,
				rows: [row],
				metas: [meta],
			});
			continue;
		}
		existing.rows.push(row);
		existing.metas.push(meta);
		if (row.createdAt < existing.createdAt) existing.createdAt = row.createdAt;
	}
	return groups;
}

const publicModelCache = createAsyncTtlCache(loadGroups, 5_000);

export function loadPublicModelGroups(): Promise<
	Map<string, PublicModelGroup>
> {
	return publicModelCache.get();
}

export function invalidatePublicModelGroups(): void {
	publicModelCache.invalidate();
}
