import type { CatalogSource, EnrichmentSource } from "../types.ts";
import { openRouterSource } from "./openrouter.ts";
import { modelsDevSource } from "./modelsDev.ts";
import { vercelSource } from "./vercel.ts";

/**
 * Existence sources: vote on whether a (adapter, upstream model, provider) combination is real (see
 * match.ts). Adding a new one is: implement CatalogSource in a new file under sources/, push it here.
 */
export const ACTIVE_EXISTENCE_SOURCES: readonly CatalogSource[] = [
	vercelSource,
	openRouterSource,
];

/**
 * Enrichment sources: never vote on existence, only enrich a candidate already confirmed by the existence
 * sources (see enrich.ts). Adding a new one is: implement EnrichmentSource, push it here.
 */
export const ACTIVE_ENRICHMENT_SOURCES: readonly EnrichmentSource[] = [
	modelsDevSource,
];

export { vercelSource, openRouterSource, modelsDevSource };
