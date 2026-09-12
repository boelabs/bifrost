import { loadCatalogDocument } from "./jsonCatalog.ts";
import { MODEL_CATALOG } from "#adapters/index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const catalogs = [
	{
		adapterKey: "openai",
		url: new URL("../adapters/openai/catalog.json", import.meta.url),
	},
	{
		adapterKey: "googleaistudio",
		url: new URL("../adapters/google/catalog.json", import.meta.url),
	},
	{
		adapterKey: "anthropic",
		url: new URL("../adapters/anthropic/catalog.json", import.meta.url),
	},
	{
		adapterKey: "deepseek",
		url: new URL("../adapters/deepseek/catalog.json", import.meta.url),
	},
	{
		adapterKey: "moonshot",
		url: new URL("../adapters/moonshot/catalog.json", import.meta.url),
	},
	{
		adapterKey: "zai",
		url: new URL("../adapters/zai/catalog.json", import.meta.url),
	},
	{
		adapterKey: "minimax",
		url: new URL("../adapters/minimax/catalog.json", import.meta.url),
	},
	{
		adapterKey: "azureopenai",
		url: new URL("../adapters/azureopenai/catalog.json", import.meta.url),
	},
	{
		adapterKey: "azurefoundry",
		url: new URL("../adapters/azurefoundry/catalog.json", import.meta.url),
	},
	{
		adapterKey: "vercel",
		url: new URL("../adapters/vercel/catalog.json", import.meta.url),
	},
	{
		adapterKey: "openrouter",
		url: new URL("../adapters/openrouter/catalog.json", import.meta.url),
	},
] as const;

test("JSON provider catalogs load and match the runtime registry", () => {
	for (const catalog of catalogs) {
		const doc = loadCatalogDocument(catalog.url, {
			adapterKey: catalog.adapterKey,
		});
		assert.equal(doc.schemaVersion, 1);
		assert.equal(doc.provider.adapterKey, catalog.adapterKey);
		assert.deepEqual(
			Object.keys(doc.models).sort(),
			Object.keys(MODEL_CATALOG[catalog.adapterKey] ?? {}).sort(),
			catalog.adapterKey,
		);
	}
});

test("JSON provider catalogs keep model ids as object keys", () => {
	for (const catalog of catalogs) {
		const doc = loadCatalogDocument(catalog.url, {
			adapterKey: catalog.adapterKey,
		});
		for (const [modelId, model] of Object.entries(doc.models)) {
			assert.ok(model.operations, `${catalog.adapterKey}/${modelId}`);
			assert.equal((model as { id?: string }).id ?? modelId, modelId);
		}
	}
});
