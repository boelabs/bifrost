import { type BaseCreds, requireApiKeyCreds } from "#adapters/creds.ts";
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

export function makeVercelRerankHandler(
	defaultBaseUrl = "https://ai-gateway.vercel.sh/v1",
): RerankHandler {
	return {
		buildRequest(req, ctx) {
			const credentials = requireApiKeyCreds<Creds>(
				ctx.credentials,
				"Vercel AI Gateway adapter",
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
					return_documents: false,
				}),
			};
		},
		parseResponse(raw) {
			const value = record(raw);
			const rawResults = Array.isArray(value?.results) ? value.results : [];
			const meta = record(value?.meta);
			const billedUnits = record(meta?.billed_units);
			const tokens = record(meta?.tokens);
			const rawUsage = record(value?.usage);
			const totalTokens =
				number(rawUsage?.total_tokens) ?? number(tokens?.input_tokens);
			const searchUnits = number(billedUnits?.search_units);
			return {
				...(typeof value?.id === "string" ? { id: value.id } : {}),
				results: rawResults.map((item) => {
					const result = record(item);
					return {
						index: number(result?.index) ?? Number.NaN,
						relevanceScore: number(result?.relevance_score) ?? Number.NaN,
					};
				}),
				...(totalTokens !== undefined || searchUnits !== undefined
					? {
							usage: {
								promptTokens: totalTokens ?? 0,
								completionTokens: 0,
								totalTokens: totalTokens ?? 0,
								...(searchUnits !== undefined ? { searchUnits } : {}),
							},
						}
					: {}),
			};
		},
		mapError(err, ctx) {
			return mapUpstreamHttpError(err, { label: "Vercel AI Gateway" }, ctx);
		},
	};
}
