import type { OpenRouterModel } from "./sources/openrouter.ts";
import type { CatalogDocument } from "#catalog/jsonCatalog.ts";
import type { CatalogEntry } from "#catalog/types.ts";

/** Reviewed OpenRouter prices, expressed in USD cents per search unit. */
const SEARCH_UNIT_CENTS: Readonly<Record<string, number>> = {
	"cohere/rerank-4-fast": 0.2,
	"cohere/rerank-4-pro": 0.25,
	"cohere/rerank-v3.5": 0.1,
};

export interface OpenRouterRerankCatalogReport {
	sourceModels: number;
	includedModels: number;
	skippedModels: Array<{ id: string; reason: string }>;
	ambiguousZeroPricing: string[];
	multimodalRerankWithheld: string[];
	orphanedPricingOverrides: string[];
	paidModelsWithoutCost: string[];
}

export interface OpenRouterRerankCatalogGeneration {
	document: CatalogDocument;
	report: OpenRouterRerankCatalogReport;
}

function positiveInteger(value: number | null | undefined): number | undefined {
	return value !== undefined &&
		value !== null &&
		Number.isInteger(value) &&
		value > 0
		? value
		: undefined;
}

function hasAmbiguousZeroPricing(model: OpenRouterModel): boolean {
	if (!model.pricing) return false;
	const prompt = model.pricing.prompt;
	const completion = model.pricing.completion;
	return prompt === "0" && completion === "0" && !model.id.endsWith(":free");
}

function entryFor(
	model: OpenRouterModel,
	report: OpenRouterRerankCatalogReport,
): CatalogEntry {
	const maxTokensPerDocument = positiveInteger(
		model.top_provider?.context_length ?? model.context_length,
	);
	const searchUnitCents =
		SEARCH_UNIT_CENTS[model.id] ?? (model.id.endsWith(":free") ? 0 : undefined);
	if (hasAmbiguousZeroPricing(model))
		report.ambiguousZeroPricing.push(model.id);
	if (model.architecture?.input_modalities?.includes("image"))
		report.multimodalRerankWithheld.push(model.id);
	if (searchUnitCents === undefined && !model.id.endsWith(":free"))
		report.paidModelsWithoutCost.push(model.id);
	return {
		operations: {
			rerank: {
				documentModalities: ["text"],
				maxDocuments: 1_000,
				...(maxTokensPerDocument !== undefined ? { maxTokensPerDocument } : {}),
				...(model.id.startsWith("cohere/")
					? { documentsPerSearchUnit: 100 }
					: {}),
			},
		},
		...(searchUnitCents !== undefined ? { pricing: { searchUnitCents } } : {}),
	};
}

export function buildOpenRouterRerankCatalog(
	sourceModels: readonly OpenRouterModel[],
): OpenRouterRerankCatalogGeneration {
	const report: OpenRouterRerankCatalogReport = {
		sourceModels: sourceModels.length,
		includedModels: 0,
		skippedModels: [],
		ambiguousZeroPricing: [],
		multimodalRerankWithheld: [],
		orphanedPricingOverrides: [],
		paidModelsWithoutCost: [],
	};
	const models: Record<string, CatalogEntry> = {};
	const seen = new Set<string>();
	for (const model of [...sourceModels].sort((a, b) =>
		a.id.localeCompare(b.id),
	)) {
		if (!model.id?.includes("/"))
			throw new Error(
				`Invalid OpenRouter model id: ${JSON.stringify(model.id)}`,
			);
		if (seen.has(model.id))
			throw new Error(`Duplicate OpenRouter model id: ${model.id}`);
		seen.add(model.id);
		if (!model.architecture?.output_modalities?.includes("rerank")) {
			report.skippedModels.push({
				id: model.id,
				reason: 'Source model does not declare output modality "rerank"',
			});
			continue;
		}
		models[model.id] = entryFor(model, report);
		report.includedModels += 1;
	}
	for (const id of Object.keys(SEARCH_UNIT_CENTS)) {
		if (!seen.has(id)) report.orphanedPricingOverrides.push(id);
	}
	return {
		document: {
			$schema: "../../../schemas/model-catalog.schema.json",
			schemaVersion: 1,
			provider: {
				id: "openrouter",
				adapterKey: "openrouter",
				name: "OpenRouter",
				docs: [
					"https://openrouter.ai/docs/api/api-reference/rerank/submit-a-rerank-request",
					"https://openrouter.ai/docs/guides/routing/provider-selection",
				],
			},
			models,
		},
		report,
	};
}
