import { dollarsPerMillionToCentsPerMillion } from "../pricing.ts";
import { fetchJsonWithRetry } from "../fetch.ts";

import type {
	ModelsDevReasoningOption,
	EnrichmentFetchResult,
	EnrichmentSource,
	EnrichmentModel,
} from "../types.ts";

interface ModelsDevReasoningOptionRaw {
	type: "toggle" | "effort" | "budget_tokens";
	values?: string[];
	min?: number;
	max?: number;
}

interface ModelsDevCost {
	input?: number;
	output?: number;
	cache_read?: number;
	cache_write?: number;
}

interface ModelsDevLimit {
	context?: number;
	input?: number;
	output?: number;
}

interface ModelsDevModel {
	id: string;
	reasoning?: boolean;
	reasoning_options?: ModelsDevReasoningOptionRaw[];
	cost?: ModelsDevCost;
	limit?: ModelsDevLimit;
}

interface ModelsDevProvider {
	id: string;
	models: Record<string, ModelsDevModel>;
}

type ModelsDevDocument = Record<string, ModelsDevProvider>;

const DOCUMENT_URL = "https://models.dev/api.json";

function normalizeReasoningOptions(
	raw: ModelsDevReasoningOptionRaw[] | undefined,
): ModelsDevReasoningOption[] | undefined {
	if (!raw || raw.length === 0) return undefined;
	const options: ModelsDevReasoningOption[] = [];
	for (const option of raw) {
		if (option.type === "toggle") {
			options.push({ type: "toggle" });
		} else if (option.type === "effort") {
			options.push({ type: "effort", values: option.values ?? [] });
		} else if (option.type === "budget_tokens") {
			options.push({
				type: "budget_tokens",
				...(option.min !== undefined ? { min: option.min } : {}),
				...(option.max !== undefined ? { max: option.max } : {}),
			});
		}
	}
	return options.length > 0 ? options : undefined;
}

function normalizePricing(
	cost: ModelsDevCost | undefined,
): EnrichmentModel["pricing"] {
	if (!cost) return undefined;
	const result: NonNullable<EnrichmentModel["pricing"]> = {};
	const input = dollarsPerMillionToCentsPerMillion(cost.input);
	const output = dollarsPerMillionToCentsPerMillion(cost.output);
	const cacheRead = dollarsPerMillionToCentsPerMillion(cost.cache_read);
	const cacheWrite = dollarsPerMillionToCentsPerMillion(cost.cache_write);
	if (input !== undefined) result.inputCentsPerMTokens = input;
	if (output !== undefined) result.outputCentsPerMTokens = output;
	if (cacheRead !== undefined) result.cacheReadCentsPerMTokens = cacheRead;
	if (cacheWrite !== undefined) result.cacheWriteCentsPerMTokens = cacheWrite;
	return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeModel(
	providerIdRaw: string,
	model: ModelsDevModel,
): EnrichmentModel {
	const contextWindow = model.limit?.context;
	const maxOutputTokens = model.limit?.output;
	const pricing = normalizePricing(model.cost);
	const reasoningOptions = normalizeReasoningOptions(model.reasoning_options);
	return {
		providerIdRaw,
		modelIdRaw: model.id,
		...(contextWindow !== undefined ? { contextWindow } : {}),
		...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
		...(pricing ? { pricing } : {}),
		...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
		...(reasoningOptions ? { reasoningOptions } : {}),
	};
}

export const modelsDevSource: EnrichmentSource = {
	key: "models-dev",
	label: "models.dev",

	async fetchModels(): Promise<EnrichmentFetchResult> {
		const document = await fetchJsonWithRetry<ModelsDevDocument>(DOCUMENT_URL);
		const models: EnrichmentModel[] = [];
		for (const [providerIdRaw, provider] of Object.entries(document)) {
			for (const model of Object.values(provider.models ?? {})) {
				models.push(normalizeModel(providerIdRaw, model));
			}
		}
		// A single-document fetch either succeeds entirely or throws (via fetchJsonWithRetry's retries) -
		// there's no partial-failure state to track here, unlike the per-model fan-out existence sources.
		return { models, complete: true };
	},
};

export { normalizeModel };
