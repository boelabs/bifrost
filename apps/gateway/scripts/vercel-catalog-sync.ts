import { fetchVercelModels } from "#catalog/sync/sources/vercel.ts";
import { buildVercelCatalog } from "#catalog/sync/vercelCatalog.ts";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { loadCatalogDocument } from "#catalog/jsonCatalog.ts";
import assert from "node:assert/strict";

type Mode = "report" | "write" | "verify";

const CATALOG_URL = new URL(
	"../src/adapters/vercel/catalog.json",
	import.meta.url,
);
const REPORT_DIR = new URL("../.source/vercel-catalog-sync/", import.meta.url);
const MINIMUM_EXPECTED_SOURCE_MODELS = 100;

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
	const sourceModels = await fetchVercelModels();
	if (sourceModels.length < MINIMUM_EXPECTED_SOURCE_MODELS) {
		throw new Error(
			`Vercel returned only ${sourceModels.length} models; refusing to trust or write a likely partial snapshot`,
		);
	}
	const generated = buildVercelCatalog(sourceModels);
	if (generated.report.includedModels === 0) {
		throw new Error("Vercel returned no model types supported by this adapter");
	}

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
			`wrote Vercel catalog with ${generated.report.includedModels} models`,
		);
	} else if (runMode === "verify") {
		const current = loadCatalogDocument(CATALOG_URL, {
			adapterKey: "vercel",
		});
		try {
			assert.deepEqual(current, generated.document);
			console.log(
				`Vercel catalog is current (${generated.report.includedModels} models)`,
			);
		} catch {
			console.error(
				`Vercel catalog drift detected: committed=${Object.keys(current.models).length}, source=${generated.report.includedModels}`,
			);
			console.error(
				"Run `bun run catalog:sync:vercel:write`, review the diff, then format and validate.",
			);
			process.exitCode = 1;
		}
	} else {
		console.log(
			`drafted Vercel catalog with ${generated.report.includedModels}/${generated.report.sourceModels} models in .source/vercel-catalog-sync`,
		);
	}

	const skipped = Object.entries(generated.report.skippedByType)
		.map(([type, count]) => `${type}=${count}`)
		.join(", ");
	if (skipped) console.log(`skipped unsupported operations: ${skipped}`);
	if (generated.report.unrepresentedPricing.length > 0) {
		console.log(
			`pricing fields not representable by token pricing: ${generated.report.unrepresentedPricing.length}`,
		);
	}
	if (generated.report.ambiguousZeroPricing.length > 0) {
		console.warn(
			`rerank models with ambiguous zero token pricing: ${generated.report.ambiguousZeroPricing.join(", ")}`,
		);
	}
	if (generated.report.multimodalRerankWithheld.length > 0) {
		console.warn(
			`multimodal rerank capability withheld: ${generated.report.multimodalRerankWithheld.join(", ")}`,
		);
	}
	if (generated.report.paidRerankModelsWithoutCost.length > 0) {
		console.warn(
			`paid rerank models without representable cost: ${generated.report.paidRerankModelsWithoutCost.join(", ")}`,
		);
	}
	if (generated.report.orphanedRerankPricingOverrides.length > 0) {
		console.warn(
			`orphaned rerank pricing overrides: ${generated.report.orphanedRerankPricingOverrides.join(", ")}`,
		);
	}
}

await run();
