import type { CostBreakdown } from "#logging/cost.ts";

import type {
	CanonicalRerankResponse,
	CanonicalRerankRequest,
} from "#core/rerank.ts";

const encoder = new TextEncoder();

export function rerankRequestSummary(
	request: CanonicalRerankRequest,
): Record<string, unknown> {
	const documentBytes = request.documents.map((document) =>
		document.type === "text"
			? encoder.encode(document.text).length
			: encoder.encode(
					document.type === "image_url" ? document.url : document.dataUrl,
				).length,
	);
	return {
		model: request.model,
		document_count: request.documents.length,
		document_bytes: documentBytes.reduce((sum, value) => sum + value, 0),
		query_bytes: encoder.encode(request.query).length,
		...(request.topN !== undefined ? { top_n: request.topN } : {}),
		provider_options: Object.keys(request.provider ?? {}).sort(),
	};
}

export function rerankResponseSummary(
	response: CanonicalRerankResponse,
	cost: CostBreakdown | null,
): Record<string, unknown> {
	return {
		result_count: response.results.length,
		indexes: response.results.map((result) => result.index),
		usage: response.usage
			? {
					total_tokens: response.usage.totalTokens,
					...(response.usage.searchUnits !== undefined
						? { search_units: response.usage.searchUnits }
						: {}),
				}
			: null,
		cost_cents: cost?.totalCents ?? null,
	};
}
