import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { Usage } from "#core/usage.ts";

export interface CostBreakdown {
	/** Cost of non-cached input tokens, in USD cents. */
	inputCents: number;
	/** Cost of tokens read from cache, in USD cents. */
	cacheReadCents: number;
	/** Cost of tokens written to cache (cache creation), in USD cents. */
	cacheWriteCents: number;
	/** Cost of output tokens, in USD cents; image output included. */
	outputCents: number;
	/** The part of `inputCents` and `outputCents` charged at image rates, in USD cents. */
	imageCents: number;
	/** The part of `inputCents` and `outputCents` charged at audio rates, in USD cents. */
	audioCents: number;
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
	let cacheWriteByTtl = p.cacheWriteCentsPerMTokensByTtl;
	// Image and audio rates are explicit or follow the effective text rates, tier by tier.
	let imageInput = p.imageInputCentsPerMTokens;
	let imageOutput = p.imageOutputCentsPerMTokens;
	let audioInput = p.audioInputCentsPerMTokens;
	let audioOutput = p.audioOutputCentsPerMTokens;

	const tiers = [...(p.tiers ?? [])].sort(
		(a, b) => a.aboveInputTokens - b.aboveInputTokens,
	);
	for (const t of tiers) {
		if (promptTokens > t.aboveInputTokens) {
			if (t.inputCentsPerMTokens !== undefined) {
				input = t.inputCentsPerMTokens;
			}
			if (t.outputCentsPerMTokens !== undefined) {
				output = t.outputCentsPerMTokens;
			}
			imageInput = t.imageInputCentsPerMTokens ?? imageInput;
			imageOutput = t.imageOutputCentsPerMTokens ?? imageOutput;
			audioInput = t.audioInputCentsPerMTokens ?? audioInput;
			audioOutput = t.audioOutputCentsPerMTokens ?? audioOutput;
			if (t.cacheReadCentsPerMTokens !== undefined) {
				cacheRead = t.cacheReadCentsPerMTokens;
			}
			if (t.cacheWriteCentsPerMTokensByTtl !== undefined) {
				cacheWriteByTtl = {
					...cacheWriteByTtl,
					...t.cacheWriteCentsPerMTokensByTtl,
				};
			}
			if (t.cacheWriteCentsPerMTokens !== undefined) {
				cacheWrite = t.cacheWriteCentsPerMTokens;
			}
		}
	}
	return {
		inputCentsPerMTokens: input,
		outputCentsPerMTokens: output,
		cacheReadCentsPerMTokens: cacheRead,
		cacheWriteCentsPerMTokens: cacheWrite,
		imageInputCentsPerMTokens: imageInput ?? input,
		imageOutputCentsPerMTokens: imageOutput ?? output,
		audioInputCentsPerMTokens: audioInput ?? input,
		audioOutputCentsPerMTokens: audioOutput ?? output,
		...(cacheWriteByTtl === undefined
			? {}
			: { cacheWriteCentsPerMTokensByTtl: cacheWriteByTtl }),
		...(p.searchUnitCents === undefined
			? {}
			: { searchUnitCents: p.searchUnitCents }),
	};
}

/**
 * Computes the cost from the model's pricing (cents per 1M tokens) and the usage.
 * `cacheReadTokens` and `cacheWriteTokens` are disjoint subsets of promptTokens: they are subtracted
 * from input and charged at their rate (read -> cacheRead or input; write -> cacheWrite or input).
 * Image and audio tokens are subsets too: uncached image/audio input and image/audio output are
 * charged at their own rates, which default to the text rates. If the model has a context-tiered rate, the tier is applied
 * based on promptTokens. No pricing -> 0.
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

	const imageInputRate = (r.imageInputCentsPerMTokens ?? 0) / 1_000_000;
	const imageOutputRate = (r.imageOutputCentsPerMTokens ?? 0) / 1_000_000;
	// Cached tokens are billed at the cache rates whatever their modality, so only the uncached share
	// of image input can be charged at the image rate.
	const imagePrompt = Math.min(
		nonCachedPrompt,
		Math.max(0, usage.promptImageTokens ?? 0),
	);
	const imageCompletion = Math.min(
		usage.completionTokens,
		Math.max(0, usage.completionImageTokens ?? 0),
	);
	const imageCents =
		imagePrompt * imageInputRate + imageCompletion * imageOutputRate;
	const audioInputRate = (r.audioInputCentsPerMTokens ?? 0) / 1_000_000;
	const audioOutputRate = (r.audioOutputCentsPerMTokens ?? 0) / 1_000_000;
	const audioPrompt = Math.min(
		nonCachedPrompt - imagePrompt,
		Math.max(0, usage.promptAudioTokens ?? 0),
	);
	const audioCompletion = Math.min(
		usage.completionTokens - imageCompletion,
		Math.max(0, usage.completionAudioTokens ?? 0),
	);
	const audioCents =
		audioPrompt * audioInputRate + audioCompletion * audioOutputRate;
	const inputCents =
		(nonCachedPrompt - imagePrompt - audioPrompt) * inputRate +
		imagePrompt * imageInputRate +
		audioPrompt * audioInputRate;
	const cacheReadCents = cacheRead * cacheReadRate;
	let cacheWriteCents = 0;
	let remainingWrites = cacheWrite;
	for (const [ttl, tokens] of Object.entries(
		usage.cacheWriteTokensByTtl ?? {},
	)) {
		const count = Math.min(remainingWrites, Math.max(0, tokens));
		cacheWriteCents +=
			count *
			((r.cacheWriteCentsPerMTokensByTtl?.[ttl] ??
				r.cacheWriteCentsPerMTokens ??
				0) /
				1_000_000);
		remainingWrites -= count;
	}
	cacheWriteCents += remainingWrites * cacheWriteRate;
	const outputCents =
		(usage.completionTokens - imageCompletion - audioCompletion) * outputRate +
		imageCompletion * imageOutputRate +
		audioCompletion * audioOutputRate;
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
			configuredPricing.cacheWriteCentsPerMTokensByTtl !== undefined ||
			configuredPricing.imageInputCentsPerMTokens !== undefined ||
			configuredPricing.imageOutputCentsPerMTokens !== undefined ||
			configuredPricing.audioInputCentsPerMTokens !== undefined ||
			configuredPricing.audioOutputCentsPerMTokens !== undefined ||
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
		imageCents,
		audioCents,
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
	const { pricing } = meta;
	if (pricing === undefined) {
		return null;
	}
	const rates = [
		pricing.inputCentsPerMTokens,
		pricing.outputCentsPerMTokens,
		pricing.cacheReadCentsPerMTokens,
		pricing.cacheWriteCentsPerMTokens,
		pricing.imageInputCentsPerMTokens,
		pricing.imageOutputCentsPerMTokens,
		pricing.audioInputCentsPerMTokens,
		pricing.audioOutputCentsPerMTokens,
		...Object.values(pricing.cacheWriteCentsPerMTokensByTtl ?? {}),
		...(pricing.tiers ?? []).flatMap((tier) => [
			tier.inputCentsPerMTokens,
			tier.outputCentsPerMTokens,
			tier.cacheReadCentsPerMTokens,
			tier.cacheWriteCentsPerMTokens,
			tier.imageInputCentsPerMTokens,
			tier.imageOutputCentsPerMTokens,
			tier.audioInputCentsPerMTokens,
			tier.audioOutputCentsPerMTokens,
			...Object.values(tier.cacheWriteCentsPerMTokensByTtl ?? {}),
		]),
	].filter((rate): rate is number => rate !== undefined);
	if (rates.length === 0 && pricing.searchUnitCents === undefined) {
		return null;
	}
	const maximumTokenRate = rates.length > 0 ? Math.max(...rates) : 0;
	return (
		(Math.max(0, totalTokens) * maximumTokenRate) / 1_000_000 +
		Math.max(0, searchUnits) * (pricing.searchUnitCents ?? 0)
	);
}
