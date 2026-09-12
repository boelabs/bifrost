import { type BaseCreds, requireApiKeyCreds } from "#adapters/creds.ts";
import { adapterContextDiagnostics } from "#adapters/diagnostics.ts";
import { mapUpstreamHttpError } from "#adapters/upstreamError.ts";
import { textFromRerankDocument } from "#core/rerank.ts";
import type { RerankHandler } from "#adapters/types.ts";

type Creds = BaseCreds;

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function number(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}

export function makeOpenRouterRerankHandler(
	defaultBaseUrl = "https://openrouter.ai/api/v1",
): RerankHandler {
	return {
		supportsProviderRouting: true,
		buildRequest(req, ctx) {
			const credentials = requireApiKeyCreds<Creds>(
				ctx.credentials,
				"OpenRouter adapter",
			);
			const base = (credentials.baseUrl ?? defaultBaseUrl).replace(/\/+$/, "");
			return {
				method: "POST",
				url: `${base}/rerank`,
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${credentials.apiKey}`,
					...(credentials.headers ?? {}),
				},
				body: JSON.stringify({
					model: ctx.upstreamModel,
					query: req.query,
					documents: req.documents.map(textFromRerankDocument),
					...(req.topN !== undefined ? { top_n: req.topN } : {}),
					...(req.provider !== undefined ? { provider: req.provider } : {}),
				}),
			};
		},
		parseResponse(raw, ctx) {
			const value = record(raw);
			if (typeof value?.id === "string")
				adapterContextDiagnostics(ctx).providerRequestId = value.id;
			const rawResults = Array.isArray(value?.results) ? value.results : [];
			const usage = record(value?.usage);
			const totalTokens = number(usage?.total_tokens);
			const searchUnits = number(usage?.search_units);
			const providerCost = number(usage?.cost);
			const hasUsage =
				totalTokens !== undefined ||
				searchUnits !== undefined ||
				providerCost !== undefined;
			return {
				...(typeof value?.id === "string" ? { id: value.id } : {}),
				...(typeof value?.provider === "string"
					? { provider: value.provider }
					: {}),
				results: rawResults.map((item) => {
					const result = record(item);
					return {
						index: number(result?.index) ?? Number.NaN,
						relevanceScore: number(result?.relevance_score) ?? Number.NaN,
					};
				}),
				...(hasUsage
					? {
							usage: {
								promptTokens: totalTokens ?? 0,
								completionTokens: 0,
								totalTokens: totalTokens ?? 0,
								...(searchUnits !== undefined ? { searchUnits } : {}),
								...(providerCost !== undefined
									? { providerCostCents: providerCost * 100 }
									: {}),
							},
						}
					: {}),
			};
		},
		mapError(err, ctx) {
			return mapUpstreamHttpError(err, { label: "OpenRouter" }, ctx);
		},
	};
}
