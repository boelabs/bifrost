import type { NormalizedPricing } from "./types.ts";

/**
 * Vercel AI Gateway and OpenRouter both price in dollars-per-token strings (e.g. "0.000002"). Shared here
 * so the two sources can't drift into two slightly different conversions the way the pre-existing
 * `normalizeProvider`/`normalizeCatalogKey` duplication did.
 */
export function dollarsPerTokenToCentsPerMillion(
	value: string | undefined,
): number | undefined {
	if (value === undefined || value.length === 0) return undefined;
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) return undefined;
	return Math.round(parsed * 100_000_000 * 1e6) / 1e6;
}

/** models.dev prices in dollars-per-million-tokens as a plain number (e.g. 1.25), not per-token. */
export function dollarsPerMillionToCentsPerMillion(
	value: number | undefined,
): number | undefined {
	if (value === undefined || !Number.isFinite(value)) return undefined;
	return Math.round(value * 100 * 1e6) / 1e6;
}

export interface RawDollarPricing {
	prompt?: string;
	completion?: string;
	input_cache_read?: string;
	input_cache_write?: string;
	[key: string]: unknown;
}

export function pricingFromDollarStrings(
	pricing: RawDollarPricing | undefined,
): NormalizedPricing | undefined {
	if (!pricing) return undefined;
	const result: NormalizedPricing = {};
	const input = dollarsPerTokenToCentsPerMillion(pricing.prompt);
	const output = dollarsPerTokenToCentsPerMillion(pricing.completion);
	const cacheRead = dollarsPerTokenToCentsPerMillion(pricing.input_cache_read);
	const cacheWrite = dollarsPerTokenToCentsPerMillion(
		pricing.input_cache_write,
	);
	if (input !== undefined) result.inputCentsPerMTokens = input;
	if (output !== undefined) result.outputCentsPerMTokens = output;
	if (cacheRead !== undefined) result.cacheReadCentsPerMTokens = cacheRead;
	if (cacheWrite !== undefined) result.cacheWriteCentsPerMTokens = cacheWrite;
	return Object.keys(result).length > 0 ? result : undefined;
}
