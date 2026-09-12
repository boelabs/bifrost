import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { Usage } from "#core/usage.ts";

export interface CostBreakdown {
	/** Cost of non-cached input tokens, in USD cents. */
	inputCents: number;
	/** Cost of tokens read from cache, in USD cents. */
	cacheReadCents: number;
	/** Cost of tokens written to cache (cache creation), in USD cents. */
	cacheWriteCents: number;
	/** Cost of output tokens, in USD cents. */
	outputCents: number;
	/** Cost of reranking search units, in USD cents. */
	searchUnitCents: number;
	/** Cost reported by the upstream, retained separately for reconciliation. */
	providerReportedCents: number | null;
	/** Total in USD cents. */
	totalCents: number;
}

type PricingShape = NonNullable<ResolvedModelMetadata["pricing"]>;

/**
 * Effective rates (cents per 1M) based on the prompt size. Starts from the base rate and applies the
 * highest `aboveInputTokens` tier that `promptTokens` exceeds (a step function over the WHOLE request).
 * cache read/write fall back to the input rate if they have no own rate at that level.
 */
function effectiveRates(p: PricingShape, promptTokens: number): PricingShape {
	let input = p.inputCentsPerMTokens ?? 0;
	let output = p.outputCentsPerMTokens ?? 0;
	let cacheRead = p.cacheReadCentsPerMTokens ?? p.inputCentsPerMTokens ?? 0;
	let cacheWrite = p.cacheWriteCentsPerMTokens ?? p.inputCentsPerMTokens ?? 0;

	const tiers = [...(p.tiers ?? [])].sort(
		(a, b) => a.aboveInputTokens - b.aboveInputTokens,
	);
	for (const t of tiers) {
		if (promptTokens > t.aboveInputTokens) {
			if (t.inputCentsPerMTokens !== undefined) input = t.inputCentsPerMTokens;
			if (t.outputCentsPerMTokens !== undefined)
				output = t.outputCentsPerMTokens;
			if (t.cacheReadCentsPerMTokens !== undefined)
				cacheRead = t.cacheReadCentsPerMTokens;
			if (t.cacheWriteCentsPerMTokens !== undefined)
				cacheWrite = t.cacheWriteCentsPerMTokens;
		}
	}
	return {
		inputCentsPerMTokens: input,
		outputCentsPerMTokens: output,
		cacheReadCentsPerMTokens: cacheRead,
		cacheWriteCentsPerMTokens: cacheWrite,
		...(p.searchUnitCents !== undefined
			? { searchUnitCents: p.searchUnitCents }
			: {}),
	};
}

/**
 * Computes the cost from the model's pricing (cents per 1M tokens) and the usage.
 * `cacheReadTokens` and `cacheWriteTokens` are disjoint subsets of promptTokens: they are subtracted
 * from input and charged at their rate (read -> cacheRead or input; write -> cacheWrite or input). If the
 * model has a context-tiered rate, the tier is applied based on promptTokens. No pricing -> 0.
 */
export function computeCost(
	meta: Pick<ResolvedModelMetadata, "pricing">,
	usage: Usage,
): CostBreakdown {
	const r = effectiveRates(meta.pricing ?? {}, usage.promptTokens);
	const inputRate = (r.inputCentsPerMTokens ?? 0) / 1_000_000;
	const outputRate = (r.outputCentsPerMTokens ?? 0) / 1_000_000;
	const cacheReadRate = (r.cacheReadCentsPerMTokens ?? 0) / 1_000_000;
	const cacheWriteRate = (r.cacheWriteCentsPerMTokens ?? 0) / 1_000_000;

	const cacheRead = usage.cacheReadTokens ?? 0;
	const cacheWrite = usage.cacheWriteTokens ?? 0;
	const nonCachedPrompt = Math.max(
		0,
		usage.promptTokens - cacheRead - cacheWrite,
	);

	const inputCents = nonCachedPrompt * inputRate;
	const cacheReadCents = cacheRead * cacheReadRate;
	const cacheWriteCents = cacheWrite * cacheWriteRate;
	const outputCents = usage.completionTokens * outputRate;
	const searchUnitCents =
		(usage.searchUnits ?? 0) * (meta.pricing?.searchUnitCents ?? 0);
	const providerReportedCents = usage.providerCostCents ?? null;
	const configuredPricing = meta.pricing;
	const hasConfiguredPricing =
		configuredPricing !== undefined &&
		(configuredPricing.inputCentsPerMTokens !== undefined ||
			configuredPricing.outputCentsPerMTokens !== undefined ||
			configuredPricing.cacheReadCentsPerMTokens !== undefined ||
			configuredPricing.cacheWriteCentsPerMTokens !== undefined ||
			configuredPricing.searchUnitCents !== undefined ||
			(configuredPricing.tiers?.length ?? 0) > 0);
	const calculatedCents =
		inputCents +
		cacheReadCents +
		cacheWriteCents +
		outputCents +
		searchUnitCents;

	return {
		inputCents,
		cacheReadCents,
		cacheWriteCents,
		outputCents,
		searchUnitCents,
		providerReportedCents,
		totalCents: hasConfiguredPricing
			? calculatedCents
			: (providerReportedCents ?? calculatedCents),
	};
}

/**
 * Conservative upper bound used for pre-execution budget admission. Every reserved token is priced
 * at the highest configured token rate across base and context tiers; rerank units are added at their
 * exact configured unit rate. `null` means pricing is unknown, not free.
 */
export function estimateMaximumCostCents(
	meta: Pick<ResolvedModelMetadata, "pricing">,
	totalTokens: number,
	searchUnits = 0,
): number | null {
	const pricing = meta.pricing;
	if (pricing === undefined) return null;
	const rates = [
		pricing.inputCentsPerMTokens,
		pricing.outputCentsPerMTokens,
		pricing.cacheReadCentsPerMTokens,
		pricing.cacheWriteCentsPerMTokens,
		...(pricing.tiers ?? []).flatMap((tier) => [
			tier.inputCentsPerMTokens,
			tier.outputCentsPerMTokens,
			tier.cacheReadCentsPerMTokens,
			tier.cacheWriteCentsPerMTokens,
		]),
	].filter((rate): rate is number => rate !== undefined);
	if (rates.length === 0 && pricing.searchUnitCents === undefined) return null;
	const maximumTokenRate = rates.length > 0 ? Math.max(...rates) : 0;
	return (
		(Math.max(0, totalTokens) * maximumTokenRate) / 1_000_000 +
		Math.max(0, searchUnits) * (pricing.searchUnitCents ?? 0)
	);
}
