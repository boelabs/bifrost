/**
 * Central provider registry. Importing this module (side-effect) registers every adapter available in
 * code and assembles its JSON model catalog. Each provider contributes its adapter; if it declares a
 * `catalogUrl`, that JSON is required to register the provider. The exception is `openaicompatible`,
 * which by design has no catalog and accepts custom models declared in the DB.
 */

import { openaicompatibleProvider } from "./openaicompatible/index.ts";
import { azurefoundryProvider } from "./azurefoundry/index.ts";
import { loadProviderCatalog } from "#catalog/jsonCatalog.ts";
import { azureopenaiProvider } from "./azureopenai/index.ts";
import { openrouterProvider } from "./openrouter/index.ts";
import type { Adapter, ProviderModule } from "./types.ts";
import { anthropicProvider } from "./anthropic/index.ts";
import { deepseekProvider } from "./deepseek/index.ts";
import { moonshotProvider } from "./moonshot/index.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import { minimaxProvider } from "./minimax/index.ts";
import { vercelProvider } from "./vercel/index.ts";
import { openaiProvider } from "./openai/index.ts";
import { googleProvider } from "./google/index.ts";
import { registerAdapter } from "./registry.ts";
import { zaiProvider } from "./zai/index.ts";

interface ProviderRegistration {
	provider: ProviderModule;
	/** Absent = custom/flexible provider without a built-in catalog. */
	catalogUrl?: URL;
}

const PROVIDER_REGISTRATIONS: readonly ProviderRegistration[] = [
	{
		provider: openaiProvider,
		catalogUrl: new URL("./openai/catalog.json", import.meta.url),
	},
	{ provider: openaicompatibleProvider },
	{
		provider: googleProvider,
		catalogUrl: new URL("./google/catalog.json", import.meta.url),
	},
	{
		provider: anthropicProvider,
		catalogUrl: new URL("./anthropic/catalog.json", import.meta.url),
	},
	// OpenAI-compatible providers with their own catalog (default base URL + model metadata).
	{
		provider: deepseekProvider,
		catalogUrl: new URL("./deepseek/catalog.json", import.meta.url),
	},
	{
		provider: moonshotProvider,
		catalogUrl: new URL("./moonshot/catalog.json", import.meta.url),
	},
	{
		provider: zaiProvider,
		catalogUrl: new URL("./zai/catalog.json", import.meta.url),
	},
	{
		provider: minimaxProvider,
		catalogUrl: new URL("./minimax/catalog.json", import.meta.url),
	},
	{
		provider: azureopenaiProvider,
		catalogUrl: new URL("./azureopenai/catalog.json", import.meta.url),
	},
	{
		provider: azurefoundryProvider,
		catalogUrl: new URL("./azurefoundry/catalog.json", import.meta.url),
	},
	{
		provider: vercelProvider,
		catalogUrl: new URL("./vercel/catalog.json", import.meta.url),
	},
	{
		provider: openrouterProvider,
		catalogUrl: new URL("./openrouter/catalog.json", import.meta.url),
	},
];

/** Model catalog per adapter, assembled from catalog.json. Source of getCatalogEntry. */
export const MODEL_CATALOG: Record<string, Record<string, CatalogEntry>> = {};

/**
 * Catalog↔adapter invariant: each `reasoning.kind` in a provider's catalog must be a family its
 * adapter can emit (`adapter.reasoningKinds`). This used to fail at request time; now it fails at
 * startup.
 */
export function validateProvider(
	adapter: Adapter,
	catalog: Record<string, CatalogEntry> | undefined,
): void {
	if (!catalog) return;
	const kinds = adapter.reasoningKinds;
	for (const [model, entry] of Object.entries(catalog)) {
		const kind = entry.operations["text.generate"]?.reasoning?.kind;
		if (kind && kinds && !kinds.has(kind)) {
			throw new Error(
				`Catalog of "${adapter.key}": model "${model}" declares reasoning.kind "${kind}", ` +
					`incompatible with the adapter (accepts: ${[...kinds].join(", ")}).`,
			);
		}
	}
}

function isMissingCatalog(err: unknown): boolean {
	return (err as { code?: unknown })?.code === "ENOENT";
}

for (const { provider, catalogUrl } of PROVIDER_REGISTRATIONS) {
	let catalog: Record<string, CatalogEntry> | undefined;
	if (catalogUrl) {
		try {
			catalog = loadProviderCatalog(catalogUrl, {
				adapterKey: provider.adapter.key,
			});
		} catch (err) {
			if (isMissingCatalog(err)) continue;
			throw err;
		}
	}
	registerAdapter(provider.adapter); // validates CallTypes↔handlers and rejects duplicates
	validateProvider(provider.adapter, catalog);
	if (catalog) MODEL_CATALOG[provider.adapter.key] = catalog;
}
