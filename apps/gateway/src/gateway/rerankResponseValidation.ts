import { isUsageConsistent } from "#core/usage.ts";
import { GatewayError } from "#core/errors.ts";

import type {
	CanonicalRerankResponse,
	CanonicalRerankRequest,
} from "#core/rerank.ts";

function protocol(message: string): never {
	throw new GatewayError({
		class: "server",
		code: "upstream_protocol_error",
		message,
		failureKind: "transient",
		deploymentHealth: "penalize",
	});
}

export function assertRerankResponseValid(
	request: CanonicalRerankRequest,
	response: CanonicalRerankResponse,
): void {
	const expected = Math.min(
		request.topN ?? request.documents.length,
		request.documents.length,
	);
	if (response.results.length !== expected)
		protocol(
			`Upstream rerank response contained ${response.results.length} results; expected ${expected}`,
		);
	const indexes = new Set<number>();
	let previousScore = Number.POSITIVE_INFINITY;
	for (const result of response.results) {
		if (
			!Number.isSafeInteger(result.index) ||
			result.index < 0 ||
			result.index >= request.documents.length
		)
			protocol("Upstream rerank response contained an out-of-range index");
		if (indexes.has(result.index))
			protocol("Upstream rerank response contained duplicate indexes");
		indexes.add(result.index);
		if (!Number.isFinite(result.relevanceScore))
			protocol(
				"Upstream rerank response contained a non-finite relevance score",
			);
		if (result.relevanceScore > previousScore)
			protocol(
				"Upstream rerank response was not sorted by descending relevance",
			);
		previousScore = result.relevanceScore;
	}
	const usage = response.usage;
	if (!usage) return;
	for (const value of [
		usage.promptTokens,
		usage.completionTokens,
		usage.totalTokens,
		usage.searchUnits,
		usage.providerCostCents,
	]) {
		if (value !== undefined && (!Number.isFinite(value) || value < 0))
			protocol("Upstream rerank response contained invalid usage");
	}
	if (
		!Number.isSafeInteger(usage.promptTokens) ||
		!Number.isSafeInteger(usage.completionTokens) ||
		!Number.isSafeInteger(usage.totalTokens) ||
		(usage.searchUnits !== undefined &&
			!Number.isSafeInteger(usage.searchUnits)) ||
		!isUsageConsistent(usage)
	)
		protocol("Upstream rerank response contained inconsistent usage");
}
