import { buildOpenRouterRerankCatalog } from "#catalog/sync/openRouterRerankCatalog.ts";
import { fetchOpenRouterRerankModels } from "#catalog/sync/sources/openrouter.ts";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { loadCatalogDocument } from "#catalog/jsonCatalog.ts";
import assert from "node:assert/strict";

type Mode = "report" | "write" | "verify";

const CATALOG_URL = new URL(
	"../src/adapters/openrouter/catalog.json",
	import.meta.url,
);
const REPORT_DIR = new URL(
	"../.source/openrouter-catalog-sync/",
	import.meta.url,
);

function argValue(name: string): string | undefined {
	const prefix = `${name}=`;
	const directIndex = process.argv.indexOf(name);
	if (directIndex >= 0) return process.argv[directIndex + 1];
	const item = process.argv.find((arg) => arg.startsWith(prefix));
	return item?.slice(prefix.length);
}

function mode(): Mode {
	const raw = argValue("--mode") ?? "report";
	if (raw === "report" || raw === "write" || raw === "verify") return raw;
	throw new Error("--mode must be report, write, or verify");
}

function serialize(value: unknown): string {
	return `${JSON.stringify(value, null, "\t")}\n`;
}

function atomicWrite(url: URL, value: string): void {
	const temporary = new URL(`${url.pathname}.tmp`, url);
	writeFileSync(temporary, value);
	renameSync(temporary, url);
}

async function run(): Promise<void> {
	const runMode = mode();
	const sourceModels = await fetchOpenRouterRerankModels();
	if (sourceModels.length === 0)
		throw new Error("OpenRouter returned no rerank models");
	const generated = buildOpenRouterRerankCatalog(sourceModels);
	if (generated.report.includedModels === 0)
		throw new Error("OpenRouter returned no usable rerank models");

	mkdirSync(REPORT_DIR, { recursive: true });
	writeFileSync(
		new URL("report.json", REPORT_DIR),
		serialize({
			generatedAt: new Date().toISOString(),
			mode: runMode,
			...generated.report,
		}),
	);
	writeFileSync(
		new URL("catalog.json", REPORT_DIR),
		serialize(generated.document),
	);

	if (runMode === "write") {
		atomicWrite(CATALOG_URL, serialize(generated.document));
		console.log(
			`wrote OpenRouter rerank catalog with ${generated.report.includedModels} models`,
		);
	} else if (runMode === "verify") {
		const current = loadCatalogDocument(CATALOG_URL, {
			adapterKey: "openrouter",
		});
		try {
			assert.deepEqual(current, generated.document);
			console.log(
				`OpenRouter rerank catalog is current (${generated.report.includedModels} models)`,
			);
		} catch {
			console.error(
				`OpenRouter rerank catalog drift detected: committed=${Object.keys(current.models).length}, source=${generated.report.includedModels}`,
			);
			console.error(
				"Run `bun run catalog:sync:openrouter:write`, review the diff, then format and validate.",
			);
			process.exitCode = 1;
		}
	} else {
		console.log(
			`drafted OpenRouter rerank catalog with ${generated.report.includedModels}/${generated.report.sourceModels} models in .source/openrouter-catalog-sync`,
		);
	}

	if (generated.report.multimodalRerankWithheld.length > 0) {
		console.log(
			`multimodal rerank capability withheld: ${generated.report.multimodalRerankWithheld.join(", ")}`,
		);
	}
	if (generated.report.ambiguousZeroPricing.length > 0) {
		console.warn(
			`rerank models with ambiguous zero token pricing: ${generated.report.ambiguousZeroPricing.join(", ")}`,
		);
	}
	if (generated.report.paidModelsWithoutCost.length > 0) {
		console.warn(
			`paid rerank models without representable cost: ${generated.report.paidModelsWithoutCost.join(", ")}`,
		);
	}
	if (generated.report.orphanedPricingOverrides.length > 0) {
		console.warn(
			`orphaned rerank pricing overrides: ${generated.report.orphanedPricingOverrides.join(", ")}`,
		);
	}
}

await run();
