import { pendingReviewEntries } from "#catalog/needsHumanReview.ts";
import { callTypeForOperation } from "#operations/registry.ts";
import { loadCatalogDocument } from "#catalog/jsonCatalog.ts";
import type { OperationId } from "#operations/registry.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import { getAdapter } from "#adapters/registry.ts";

import "#adapters/index.ts";

const catalogs = [
	{
		adapterKey: "openai",
		url: new URL("../src/adapters/openai/catalog.json", import.meta.url),
	},
	{
		adapterKey: "googleaistudio",
		url: new URL("../src/adapters/google/catalog.json", import.meta.url),
	},
	{
		adapterKey: "anthropic",
		url: new URL("../src/adapters/anthropic/catalog.json", import.meta.url),
	},
	{
		adapterKey: "deepseek",
		url: new URL("../src/adapters/deepseek/catalog.json", import.meta.url),
	},
	{
		adapterKey: "moonshot",
		url: new URL("../src/adapters/moonshot/catalog.json", import.meta.url),
	},
	{
		adapterKey: "zai",
		url: new URL("../src/adapters/zai/catalog.json", import.meta.url),
	},
	{
		adapterKey: "minimax",
		url: new URL("../src/adapters/minimax/catalog.json", import.meta.url),
	},
	{
		adapterKey: "azureopenai",
		url: new URL("../src/adapters/azureopenai/catalog.json", import.meta.url),
	},
	{
		adapterKey: "azurefoundry",
		url: new URL("../src/adapters/azurefoundry/catalog.json", import.meta.url),
	},
	{
		adapterKey: "vercel",
		url: new URL("../src/adapters/vercel/catalog.json", import.meta.url),
	},
	{
		adapterKey: "openrouter",
		url: new URL("../src/adapters/openrouter/catalog.json", import.meta.url),
	},
] as const;

let total = 0;
const pendingReview: string[] = [];
const unrunnable: string[] = [];

/**
 * A transport a model declares but its adapter cannot run is a 404 from the provider at the first
 * request, and a confusing one: the error names an upstream model, not the entry that chose the
 * wrong API. The two are declared in different files, so only a check across both catches it.
 */
function checkDeclaredTransports(
	adapterKey: string,
	models: Record<string, CatalogEntry>,
): void {
	const adapter = getAdapter(adapterKey);
	if (!adapter) {
		unrunnable.push(`${adapterKey} has a catalog but no registered adapter`);
		return;
	}
	for (const [model, entry] of Object.entries(models)) {
		for (const [operationId, profile] of Object.entries(
			entry.operations ?? {},
		)) {
			const declared = (profile as { transport?: string } | undefined)
				?.transport;
			if (declared === undefined) continue;
			const callType = callTypeForOperation(operationId as OperationId);
			const supported = callType
				? adapter.transports?.[callType]?.supported
				: undefined;
			if (!supported?.includes(declared as never))
				unrunnable.push(
					`${adapterKey}/${model} declares transport "${declared}" for ${operationId}, ` +
						`which the adapter does not support (supported: ${supported?.join(", ") || "none"})`,
				);
		}
	}
}

for (const catalog of catalogs) {
	const doc = loadCatalogDocument(catalog.url, {
		adapterKey: catalog.adapterKey,
	});
	const count = Object.keys(doc.models).length;
	total += count;
	console.log(`${doc.provider.adapterKey}: ${count} models`);

	// catalog-sync (see src/catalog/sync/) drafts fields it can't fully verify (currently: reasoning specs
	// from models.dev) and marks them with needsHumanReview instead of applying them blindly. This is the
	// gate that makes that marker mean something: a sync PR can't merge until a human clears every one.
	pendingReview.push(...pendingReviewEntries(catalog.adapterKey, doc.models));
	checkDeclaredTransports(catalog.adapterKey, doc.models);
}

if (unrunnable.length > 0) {
	console.error("catalog validation failed: undeliverable transports:");
	for (const item of unrunnable) console.error(`  - ${item}`);
	process.exit(1);
}

if (pendingReview.length > 0) {
	console.error("catalog validation failed: entries pending human review:");
	for (const item of pendingReview) console.error(`  - ${item}`);
	console.error(
		"Verify each drafted field against the provider's actual docs, then clear needsHumanReview.",
	);
	process.exit(1);
}

console.log(`catalog ok: ${total} models`);
