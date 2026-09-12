import { fetchJsonWithRetry, isFetchComplete, boundedMap } from "../fetch.ts";

import {
	dollarsPerTokenToCentsPerMillion,
	pricingFromDollarStrings,
	type RawDollarPricing,
} from "../pricing.ts";

import type {
	SourceFetchResult,
	SourceEndpoint,
	CatalogSource,
	SourceModel,
} from "../types.ts";

export interface OpenRouterModel {
	id: string;
	name?: string;
	architecture?: {
		input_modalities?: string[];
		output_modalities?: string[];
	};
	pricing?: RawDollarPricing;
	top_provider?: {
		context_length?: number | null;
		max_completion_tokens?: number | null;
	};
	context_length?: number | null;
	supported_parameters?: string[];
}

export interface OpenRouterEndpoint {
	name?: string;
	model_id: string;
	provider_name?: string;
	tag?: string;
	context_length?: number | null;
	max_completion_tokens?: number | null;
	pricing?: RawDollarPricing;
	supported_parameters?: string[];
	status?: number;
}

const BASE_URL = "https://openrouter.ai";
const CONCURRENCY = 6;

function authHeaders(): Record<string, string> {
	const key = process.env.OPENROUTER_API_KEY;
	return key ? { authorization: `Bearer ${key}` } : {};
}

/** Lightweight inventory used by the dedicated, deterministic rerank catalog sync. */
export async function fetchOpenRouterRerankModels(): Promise<
	OpenRouterModel[]
> {
	const response = await fetchJsonWithRetry<{ data: OpenRouterModel[] }>(
		`${BASE_URL}/api/v1/models?output_modalities=rerank`,
		{ headers: authHeaders() },
	);
	return response.data;
}

function endpointPath(modelId: string): string {
	return `/api/v1/models/${modelId
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/")}/endpoints`;
}

function extractEndpoints(raw: unknown): OpenRouterEndpoint[] {
	const value = raw as {
		data?: { endpoints?: OpenRouterEndpoint[] } | OpenRouterEndpoint[];
		endpoints?: OpenRouterEndpoint[];
	};
	if (Array.isArray(value.data)) return value.data;
	if (Array.isArray(value.data?.endpoints)) return value.data.endpoints;
	if (Array.isArray(value.endpoints)) return value.endpoints;
	return [];
}

async function loadEndpoints(modelId: string): Promise<OpenRouterEndpoint[]> {
	return extractEndpoints(
		await fetchJsonWithRetry<unknown>(`${BASE_URL}${endpointPath(modelId)}`, {
			headers: authHeaders(),
		}),
	);
}

function normalizeEndpoint(raw: OpenRouterEndpoint): SourceEndpoint {
	const pricing = pricingFromDollarStrings(raw.pricing);
	return {
		providerTag: raw.tag ?? raw.provider_name ?? "",
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

function normalizeModel(
	model: OpenRouterModel,
	rawEndpoints: OpenRouterEndpoint[],
): SourceModel {
	const contextWindow =
		model.top_provider?.context_length ?? model.context_length ?? undefined;
	const pricing = pricingFromDollarStrings(model.pricing);
	return {
		source: "openrouter",
		id: model.id,
		...(model.name !== undefined ? { name: model.name } : {}),
		inputModalities: model.architecture?.input_modalities ?? [],
		outputModalities: model.architecture?.output_modalities ?? [],
		...(contextWindow != null ? { contextWindow } : {}),
		...(model.top_provider?.max_completion_tokens != null
			? { maxTokens: model.top_provider.max_completion_tokens }
			: {}),
		...(pricing ? { pricing } : {}),
		...(model.supported_parameters
			? { supportedParameters: model.supported_parameters }
			: {}),
		endpoints: rawEndpoints.map(normalizeEndpoint),
	};
}

export const openRouterSource: CatalogSource = {
	key: "openrouter",
	label: "OpenRouter",

	async fetchModels(): Promise<SourceFetchResult> {
		const listResponse = await fetchJsonWithRetry<{ data: OpenRouterModel[] }>(
			`${BASE_URL}/api/v1/models`,
			{ headers: authHeaders() },
		);
		const models = listResponse.data;
		const { succeeded, failed } = await boundedMap(
			models,
			CONCURRENCY,
			async (model) => normalizeModel(model, await loadEndpoints(model.id)),
		);
		return {
			source: "openrouter",
			models: [...succeeded.values()],
			attempted: models.length,
			failed: failed.map((model) => model.id),
			complete: isFetchComplete(models.length, failed.length),
		};
	},
};

// Re-exported for sources/openrouter.test.ts fixtures and for merge.ts's pricing conversion needs.
export { dollarsPerTokenToCentsPerMillion, normalizeModel, normalizeEndpoint };
