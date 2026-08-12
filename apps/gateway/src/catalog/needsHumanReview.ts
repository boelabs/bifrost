import type { CatalogEntry } from "./types.ts";

/**
 * Every model whose `needsHumanReview` marker is non-empty, formatted for a validation error. Pulled out
 * as its own pure function (used by scripts/validate-catalog.ts) so the gate itself - "a catalog-sync
 * draft can't merge unreviewed" - is unit-testable without executing the whole validation script.
 */
export function pendingReviewEntries(
	adapterKey: string,
	models: Record<string, CatalogEntry>,
): string[] {
	const pending: string[] = [];
	for (const [modelId, entry] of Object.entries(models)) {
		if (entry.needsHumanReview && entry.needsHumanReview.length > 0) {
			pending.push(
				`${adapterKey}/${modelId}: ${entry.needsHumanReview.join(", ")}`,
			);
		}
	}
	return pending;
}
