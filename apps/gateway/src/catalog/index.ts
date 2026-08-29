import type { CatalogEntry, ResolvedModelMetadata } from "./types.ts";
import { profileToRuntimeMetadata } from "#profiles/resolve.ts";
import type { TextCapabilities } from "#core/reasoning.ts";
import type { RuntimeModelMetadata } from "#db/schema.ts";
import { MODEL_CATALOG } from "#adapters/index.ts";

export type { CatalogEntry, ResolvedModelMetadata } from "./types.ts";

/**
 * Catalog of known models, assembled from the provider modules (`MODEL_CATALOG`): each provider
 * contributes its `upstreamModel -> CatalogEntry` slice alongside its adapter. It provides DEFAULTS
 * (capabilities, limits, reasoning control). Custom models use the same `CatalogEntry` shape in the DB;
 * the row's pricing can override the entry's rate.
 * Agnostic: each entry describes the model, it does not couple provider logic - the translation to the
 * native transport lives in each adapter.
 */

const DEFAULT_CAPABILITIES: TextCapabilities = {
	tools: true,
	strictTools: false,
	vision: true,
	reasoning: false,
	structuredOutputs: false,
};

/**
 * Looks up the catalog entry by (adapterKey, upstreamModel). Exact match and, failing that, dated
 * snapshots of the base id (e.g. "gpt-5.5-2026-04-23"). Does not match sibling variants such as
 * "gpt-4.1-nano" against "gpt-4.1", because they can be deprecated even if they share a prefix.
 */
function isSnapshotSuffix(suffix: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(suffix) || /^\d{2}-\d{4}$/.test(suffix);
}

interface AdapterCatalogIndex {
	exact: Map<string, CatalogEntry>;
	snapshotBases: Array<readonly [string, CatalogEntry]>;
}

const adapterCatalogIndexes = new WeakMap<
	Record<string, CatalogEntry>,
	AdapterCatalogIndex
>();

function catalogIndexFor(
	byAdapter: Record<string, CatalogEntry>,
): AdapterCatalogIndex {
	const cached = adapterCatalogIndexes.get(byAdapter);
	if (cached) return cached;
	const entries = Object.entries(byAdapter);
	const index: AdapterCatalogIndex = {
		exact: new Map(entries),
		// Longest base first keeps "gpt-5.4-mini-YYYY-MM-DD" from being claimed by "gpt-5.4".
		snapshotBases: entries.sort(([a], [b]) => b.length - a.length),
	};
	adapterCatalogIndexes.set(byAdapter, index);
	return index;
}

function getAdapterCatalogEntry(
	adapterKey: string,
	upstreamModel: string,
	caseInsensitive = false,
): CatalogEntry | undefined {
	const byAdapter = MODEL_CATALOG[adapterKey];
	if (!byAdapter) return undefined;
	const index = catalogIndexFor(byAdapter);
	const exact = index.exact.get(upstreamModel);
	if (exact) return exact;
	if (caseInsensitive) {
		const normalized = upstreamModel.toLowerCase();
		for (const [key, entry] of index.exact) {
			if (key.toLowerCase() === normalized) return entry;
		}
	}

	for (const [key, entry] of index.snapshotBases) {
		const prefix = `${key}-`;
		if (
			(caseInsensitive
				? upstreamModel.toLowerCase().startsWith(prefix.toLowerCase())
				: upstreamModel.startsWith(prefix)) &&
			isSnapshotSuffix(upstreamModel.slice(prefix.length))
		)
			return entry;
	}
	return undefined;
}

export function getCatalogEntry(
	adapterKey: string,
	upstreamModel: string,
): CatalogEntry | undefined {
	return getAdapterCatalogEntry(adapterKey, upstreamModel);
}

/**
 * Resolves a model's effective metadata. Two mutually exclusive sources:
 *  - **Catalog** (known model): the `(adapterKey, upstreamModel)` is in the catalog.
 *  - **Inline CatalogEntry** (custom model): the operator declared the same shape as catalog.json.
 * `pricingOverride` (the model's top-level field) wins over the catalog's pricing.
 * If capabilities.reasoning ends up false, the reasoning spec is discarded.
 */
export function resolveModelMetadata(
	adapterKey: string,
	upstreamModel: string,
	customEntry?: CatalogEntry | null,
	pricingOverride?: RuntimeModelMetadata["pricing"] | null,
): ResolvedModelMetadata {
	const entry = getCatalogEntry(adapterKey, upstreamModel);
	// A single per-operation source: the built-in catalog if the model is known, or the inline
	// CatalogEntry the operator declares for a custom model. Both flatten the same way to the runtime view.
	const selected = entry ?? customEntry ?? undefined;
	const operations = selected?.operations;
	const info = operations
		? profileToRuntimeMetadata({
				operations,
				...(selected?.pricing !== undefined
					? { pricing: selected.pricing }
					: {}),
			})
		: undefined;

	const modelCapabilities: TextCapabilities = {
		...DEFAULT_CAPABILITIES,
		...(info?.capabilities ?? {}),
	};

	const reasoning = modelCapabilities.reasoning ? info?.reasoning : undefined;
	const supportedCallTypes = info?.supportedCallTypes ?? ["chat"];
	const meta: ResolvedModelMetadata = {
		capabilities: modelCapabilities,
		supportedCallTypes: [...supportedCallTypes],
	};
	const pricing = pricingOverride ?? info?.pricing;
	if (pricing != null) meta.pricing = pricing;
	if (info?.maxInputTokens !== undefined)
		meta.maxInputTokens = info.maxInputTokens;
	if (info?.maxOutputTokens !== undefined)
		meta.maxOutputTokens = info.maxOutputTokens;
	if (reasoning !== undefined) meta.reasoning = reasoning;
	if (info?.image !== undefined) meta.image = info.image;
	if (info?.video !== undefined) meta.video = info.video;
	if (info?.embedding !== undefined) meta.embedding = info.embedding;
	if (info?.rerank !== undefined) meta.rerank = info.rerank;
	if (info?.operations !== undefined) meta.operations = info.operations;
	return meta;
}
