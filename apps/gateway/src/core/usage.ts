/**
 * Normalized token usage. The CONTRACT every adapter must respect when mapping its upstream usage
 * (each transport uses different names: `usage`, `usageMetadata`, `meta`...):
 *
 *  - `completionTokens` INCLUDES the reasoning/thinking tokens (they are not separate).
 *  - `totalTokens === promptTokens + completionTokens` (invariant).
 *  - `reasoningTokens`, `cacheReadTokens`, and `cacheWriteTokens` are OPTIONAL details and SUBSETS
 *    (reasoning of completion; read/write of prompt); they are not added to the total.
 *  - `cacheReadTokens` and `cacheWriteTokens` are disjoint from each other; both are INCLUDED in
 *    `promptTokens`. If an upstream reports them separately (Anthropic), the adapter ADDS them to the prompt.
 *
 * If the upstream separates reasoning from the visible output, the adapter adds them into
 * `completionTokens`. The cost calc and budgets depend on this semantics.
 * Use `isUsageConsistent` in tests/dev to verify it.
 */
export interface Usage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
	/** Tokens read from cache (prompt caching). Subset of promptTokens. */
	cacheReadTokens?: number;
	/** Tokens written to cache (cache creation; billed at a premium). Subset of promptTokens. */
	cacheWriteTokens?: number;
	/** Reasoning tokens. Subset of completionTokens. */
	reasoningTokens?: number;
	/** Provider-reported reranking search units. Independent from token counters. */
	searchUnits?: number;
	/** Upstream-reported request cost in USD cents, used only when configured pricing is absent. */
	providerCostCents?: number;
}

/** Does the usage satisfy the invariant total = prompt + completion? (helper for tests/dev). */
export function isUsageConsistent(u: Usage): boolean {
	return u.totalTokens === u.promptTokens + u.completionTokens;
}
