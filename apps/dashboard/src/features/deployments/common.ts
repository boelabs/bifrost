import type { components } from "#/shared/api/schema";

/**
 * The deployment vocabulary and the pure functions over it.
 *
 * `api.ts` reads cookies through `next/headers`, so a Client Component cannot import it. The dialog
 * and the model cards need these types and helpers on both sides of that boundary, so they live in a
 * module with no server import at all.
 */
export type Deployment = components["schemas"]["Deployment"];
export type CreateDeploymentInput = components["schemas"]["CreateDeployment"];
export type UpdateDeploymentInput = components["schemas"]["UpdateDeployment"];

/** A model the adapter's catalog already knows. */
export interface CatalogModel {
	id: string;
	operations: string[];
	deprecated?: boolean;
}

/** One registered adapter: which credentials it needs, what it can execute, what it knows. */
export interface AdapterSummary {
	id: string;
	credentials: { required: string[] };
	supportedCallTypes: string[];
	/**
	 * Empty is meaningful rather than missing: `openaicompatible` ships no catalog because its
	 * upstream is whatever the operator points it at, so every model there is custom by definition.
	 */
	models: CatalogModel[];
	operations: AdapterOperation[];
}

export interface AdapterOperation {
	id: string;
	label: string;
	transports: string[];
	defaultTransport: string | null;
}

/**
 * Whether the catalog already describes this upstream id, which is exactly what decides if a
 * `catalogEntry` is required. Mirrors the gateway's lookup: an exact match, or a dated snapshot of a
 * known base ("gpt-5.5-2026-04-23" resolves through "gpt-5.5"). Sibling variants deliberately do NOT
 * match — "gpt-4.1-nano" is not "gpt-4.1", because one can be deprecated while the other is not.
 */
export function isKnownUpstreamModel(
	models: CatalogModel[],
	upstreamModel: string,
): boolean {
	const id = upstreamModel.trim();
	if (!id) {
		return false;
	}
	if (models.some((model) => model.id === id)) {
		return true;
	}
	return models.some((model) => {
		if (!id.startsWith(`${model.id}-`)) {
			return false;
		}
		const suffix = id.slice(model.id.length + 1);
		return /^\d{4}-\d{2}-\d{2}$/.test(suffix) || /^\d{2}-\d{4}$/.test(suffix);
	});
}

/**
 * A Public Model is not a row: it is every deployment that shares a `publicModel`, and the router
 * derives the pool from that column. So the list groups client-side, and creating or deleting always
 * operates on a deployment — a model appears when its first deployment exists and disappears with its
 * last. See the gateway glossary.
 */
export interface PublicModelGroup {
	publicModel: string;
	deployments: Deployment[];
	enabledCount: number;
	adapters: string[];
}

export function groupByPublicModel(
	deployments: Deployment[],
): PublicModelGroup[] {
	const groups = new Map<string, Deployment[]>();
	for (const deployment of deployments) {
		const bucket = groups.get(deployment.publicModel);
		if (bucket) {
			bucket.push(deployment);
		} else {
			groups.set(deployment.publicModel, [deployment]);
		}
	}
	return [...groups.entries()]
		.map(([publicModel, rows]) => ({
			publicModel,
			deployments: rows,
			enabledCount: rows.filter((row) => row.enabled).length,
			adapters: [...new Set(rows.map((row) => row.adapterKey))].sort(),
		}))
		.sort((a, b) => a.publicModel.localeCompare(b.publicModel));
}
