import type { RuntimeModelMetadata } from "#db/schema.ts";

/**
 * Shared helper for declaring catalog pricing. Unit: USD cents per 1M tokens (the same one the DB and
 * the cost calc use). Context tiers are declared by MULTIPLIER over the base rate and resolved here to
 * absolute values (the stored model stays absolute, so cost.ts does not change). E.g. GPT-5.5 >272k =
 * x2 input/cache, x1.5 output.
 */

type Pricing = NonNullable<RuntimeModelMetadata["pricing"]>;
type StoredTier = NonNullable<Pricing["tiers"]>[number];

/** Multiplier tier. cacheRead/cacheWrite use the input multiplier if not specified. */
export interface TierMult {
	above: number;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
}

/** Sugar: `tier(272_000, { input: 2, output: 1.5 })`. */
export function tier(above: number, mult: Omit<TierMult, "above">): TierMult {
	return { above, ...mult };
}

export interface PricingInput {
	input: number;
	output: number;
	cacheRead?: number;
	/** Cache write (cache creation), for example Anthropic 5m = 1.25x input. */
	cacheWrite?: number;
	tiers?: TierMult[];
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

export function pricing(p: PricingInput): Pricing {
	const out: Pricing = {
		inputCentsPerMTokens: p.input,
		outputCentsPerMTokens: p.output,
		...(p.cacheRead !== undefined
			? { cacheReadCentsPerMTokens: p.cacheRead }
			: {}),
		...(p.cacheWrite !== undefined
			? { cacheWriteCentsPerMTokens: p.cacheWrite }
			: {}),
	};
	if (!p.tiers?.length) return out;
	out.tiers = p.tiers.map((t): StoredTier => {
		const stored: StoredTier = { aboveInputTokens: t.above };
		if (t.input !== undefined)
			stored.inputCentsPerMTokens = round(p.input * t.input);
		if (t.output !== undefined)
			stored.outputCentsPerMTokens = round(p.output * t.output);
		// cache read/write scale with the input multiplier by default (only if there is a base rate).
		if (p.cacheRead !== undefined) {
			stored.cacheReadCentsPerMTokens = round(
				p.cacheRead * (t.cacheRead ?? t.input ?? 1),
			);
		}
		if (p.cacheWrite !== undefined) {
			stored.cacheWriteCentsPerMTokens = round(
				p.cacheWrite * (t.cacheWrite ?? t.input ?? 1),
			);
		}
		return stored;
	});
	return out;
}
