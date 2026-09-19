import type { components } from "#/shared/api/schema";
import * as z from "zod/v4";

export type Pricing = NonNullable<
	components["schemas"]["CreateDeployment"]["pricing"]
>;
export type PricingTier = NonNullable<Pricing["tiers"]>[number];

export const PRICING_RATE_FIELDS = [
	"inputCentsPerMTokens",
	"outputCentsPerMTokens",
	"cacheReadCentsPerMTokens",
	"cacheWriteCentsPerMTokens",
	"searchUnitCents",
] as const;
export type PricingRateField = (typeof PRICING_RATE_FIELDS)[number];

const tokenRates = {
	inputCentsPerMTokens: z.number().nonnegative().optional(),
	outputCentsPerMTokens: z.number().nonnegative().optional(),
	cacheReadCentsPerMTokens: z.number().nonnegative().optional(),
	cacheWriteCentsPerMTokens: z.number().nonnegative().optional(),
	cacheWriteCentsPerMTokensByTtl: z
		.record(z.string().regex(/^[1-9][0-9]*$/), z.number().nonnegative())
		.optional(),
};
const pricingSchema = z
	.object({
		...tokenRates,
		searchUnitCents: z.number().nonnegative().optional(),
		tiers: z
			.array(
				z
					.object({
						aboveInputTokens: z.number().int().positive(),
						...tokenRates,
					})
					.strict(),
			)
			.refine(
				(tiers) =>
					new Set(tiers.map((tier) => tier.aboveInputTokens)).size ===
					tiers.length,
				"Context tier thresholds must be unique.",
			)
			.optional(),
	})
	.strict();

export function parsePricing(value: unknown): Pricing | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	const result = pricingSchema.safeParse(value);
	if (!result.success) {
		throw new Error(
			`Invalid pricing: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
		);
	}
	return result.data;
}
