import { pricingFromDollarStrings, type RawDollarPricing } from "../pricing.ts";
import { fetchJsonWithRetry, isFetchComplete, boundedMap } from "../fetch.ts";

import type {
	SourceReasoningOption,
	SourceFetchResult,
	SourceEndpoint,
	CatalogSource,
	SourceModel,
} from "../types.ts";

export interface VercelPricingTier {
	cost: string;
	min: number;
	max?: number;
}

/** Vercel's model-LEVEL pricing uses input/output, unlike the endpoint-level prompt/completion below. */
export interface VercelModelPricing {
	input?: string;
	input_tiers?: VercelPricingTier[];
	output?: string;
	output_tiers?: VercelPricingTier[];
	input_cache_read?: string;
	input_cache_read_tiers?: VercelPricingTier[];
	input_cache_write?: string;
	input_cache_write_tiers?: VercelPricingTier[];
	image?: string;
}

export interface VercelModel {
	id: string;
	name?: string;
	context_window?: number;
	max_tokens?: number;
	type?:
		| "language"
		| "embedding"
		| "reranking"
		| "image"
		| "video"
		| "realtime"
		| "speech"
		| "transcription";
	tags?: string[];
	modalities?: {
		input?: string[];
		output?: string[];
	};
	supported_parameters?: string[];
	reasoning_options?: Array<{
		type: "toggle" | "effort" | "budget_tokens";
		values?: string[];
		min?: number;
		max?: number;
	}>;
	pricing?: VercelModelPricing;
}

export interface VercelEndpoint {
	name?: string;
	provider_name?: string;
	context_length?: number;
	max_completion_tokens?: number;
	pricing?: RawDollarPricing; // endpoint-level uses prompt/completion, matching OpenRouter's shape
	supported_parameters?: string[];
	status?: number; // 0 = active
}

interface VercelModelEndpointsResponse {
	data?: {
		architecture?: {
			input_modalities?: string[];
			output_modalities?: string[];
		};
		endpoints?: VercelEndpoint[];
	};
}

const BASE_URL = "https://ai-gateway.vercel.sh";
const CONCURRENCY = 6;

export async function fetchVercelModels(): Promise<VercelModel[]> {
	const response = await fetchJsonWithRetry<{ data: VercelModel[] }>(
		`${BASE_URL}/v1/models`,
	);
	return response.data;
}

function endpointsPath(modelId: string): string {
	const slash = modelId.indexOf("/");
	const creator = slash === -1 ? modelId : modelId.slice(0, slash);
	const model = slash === -1 ? "" : modelId.slice(slash + 1);
	return `/v1/models/${encodeURIComponent(creator)}/${encodeURIComponent(model)}/endpoints`;
}

async function loadModelDetail(
	modelId: string,
): Promise<VercelModelEndpointsResponse["data"]> {
	const response = await fetchJsonWithRetry<VercelModelEndpointsResponse>(
		`${BASE_URL}${endpointsPath(modelId)}`,
	);
	return response.data;
}

function normalizeEndpoint(raw: VercelEndpoint): SourceEndpoint {
	const pricing = pricingFromDollarStrings(raw.pricing);
	return {
		providerTag: raw.provider_name ?? "",
		active: raw.status === undefined || raw.status === 0,
		...(raw.context_length != null
			? { contextLength: raw.context_length }
			: {}),
		...(raw.max_completion_tokens != null
			? { maxCompletionTokens: raw.max_completion_tokens }
			: {}),
		...(pricing ? { pricing } : {}),
		...(raw.supported_parameters
			? { supportedParameters: raw.supported_parameters }
			: {}),
	};
}

function normalizeModelPricing(
	pricing: VercelModelPricing | undefined,
): ReturnType<typeof pricingFromDollarStrings> {
	if (!pricing) return undefined;
	return pricingFromDollarStrings({
		...(pricing.input !== undefined ? { prompt: pricing.input } : {}),
		...(pricing.output !== undefined ? { completion: pricing.output } : {}),
		...(pricing.input_cache_read !== undefined
			? { input_cache_read: pricing.input_cache_read }
			: {}),
		...(pricing.input_cache_write !== undefined
			? { input_cache_write: pricing.input_cache_write }
			: {}),
	});
}

function normalizeReasoningOptions(
	raw: VercelModel["reasoning_options"],
): SourceReasoningOption[] | undefined {
	if (!raw || raw.length === 0) return undefined;
	const options: SourceReasoningOption[] = raw.map((option) => {
		if (option.type === "toggle") return { type: "toggle" };
		if (option.type === "effort")
			return { type: "effort", values: [...(option.values ?? [])] };
		return {
			type: "budget_tokens",
			...(option.min !== undefined ? { min: option.min } : {}),
			...(option.max !== undefined ? { max: option.max } : {}),
		};
	});
	return options.length > 0 ? options : undefined;
}

function normalizeModel(
	model: VercelModel,
	detail: VercelModelEndpointsResponse["data"],
): SourceModel {
	const pricing = normalizeModelPricing(model.pricing);
	const reasoningOptions = normalizeReasoningOptions(model.reasoning_options);
	return {
		source: "vercel-ai-gateway",
		id: model.id,
		...(model.name !== undefined ? { name: model.name } : {}),
		inputModalities:
			model.modalities?.input ?? detail?.architecture?.input_modalities ?? [],
		outputModalities:
			model.modalities?.output ?? detail?.architecture?.output_modalities ?? [],
		...(model.context_window != null
			? { contextWindow: model.context_window }
			: {}),
		...(model.max_tokens != null ? { maxTokens: model.max_tokens } : {}),
		...(pricing ? { pricing } : {}),
		...(model.supported_parameters
			? { supportedParameters: model.supported_parameters }
			: {}),
		...(reasoningOptions ? { reasoningOptions } : {}),
		// Vercel's model-level `tags` are capability tags (e.g. "reasoning", "tool-use"), not canonical
		// parameter names - only the per-endpoint `supported_parameters` carries the OpenAI-style vocabulary
		// our catalog uses, so the model-level fallback here is intentionally omitted.
		endpoints: (detail?.endpoints ?? []).map(normalizeEndpoint),
	};
}

export const vercelSource: CatalogSource = {
	key: "vercel-ai-gateway",
	label: "Vercel AI Gateway",

	async fetchModels(): Promise<SourceFetchResult> {
		const models = await fetchVercelModels();
		// No `type` filtering here: like the OpenRouter source, every model is normalized uniformly and
		// which operations apply (text/image/...) is decided downstream from modalities, not from this
		// source's own type label - keeps both existence sources symmetric.
		const { succeeded, failed } = await boundedMap(
			models,
			CONCURRENCY,
			async (model) => normalizeModel(model, await loadModelDetail(model.id)),
		);
		return {
			source: "vercel-ai-gateway",
			models: [...succeeded.values()],
			attempted: models.length,
			failed: failed.map((model) => model.id),
			complete: isFetchComplete(models.length, failed.length),
		};
	},
};

export { normalizeModel, normalizeEndpoint };
