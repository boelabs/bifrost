import { pendingReviewEntries } from "#catalog/needsHumanReview.ts";
import { loadCatalogDocument } from "#catalog/jsonCatalog.ts";

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
