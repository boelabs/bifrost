import type { CatalogEntry } from "#catalog/types.ts";
import { normalizeTag } from "./providerIdentity.ts";
import type { SourceFetchResult } from "./types.ts";
import type { MatchedCandidate } from "./match.ts";
import { confirmedKey } from "./history.ts";

export interface DeprecationCandidate {
	adapterKey: string;
	upstreamModel: string;
	entry: CatalogEntry;
	reason: string;
}

/**
 * Absence, never deletion: an entry the local history shows was previously confirmed by BOTH existence
 * sources, but that no longer appears in either source's results this run, is patched to
 * `deprecated: true` - metadata only, `operations`/`pricing` are never touched (deprecating a built-in
 * model must not change what any existing deployment resolves to on next restart). The patched entry is
 * only a report suggestion; nothing is written to any catalog.
 *
 * Gated on BOTH existence sources having had a `complete` fetch this run: a partial/failed fetch must
 * never read as "the model is gone," or a source outage would mass-flag the catalog. Models with no
 * confirmed-sighting in the history (hand-curated, provider-exclusive models never listed on either
 * aggregator) are never flagged - the trigger requires prior tracking.
 */
export function findDeprecations(
	catalogsByAdapter: ReadonlyMap<string, Record<string, CatalogEntry>>,
	matched: readonly MatchedCandidate[],
	fetchResults: readonly SourceFetchResult[],
	confirmedHistory: Readonly<Record<string, string>>,
): DeprecationCandidate[] {
	const vercel = fetchResults.find((r) => r.source === "vercel-ai-gateway");
	const openrouter = fetchResults.find((r) => r.source === "openrouter");
	if (!vercel?.complete || !openrouter?.complete) return [];

	// Normalized, not exact: a source can spell a model id differently than our catalog key (e.g.
	// OpenRouter's "claude-opus-4.5" vs. our "claude-opus-4-5", matching Anthropic's own API convention).
	// findExistingKey (scripts/catalog-sync.ts) already fuzzy-matches the same way for merges - comparing
	// deprecation presence with exact strings instead was a real bug: it silently deprecated models that
	// were actually still listed by both sources, just spelled with a "." instead of a "-".
	const presentThisRun = new Set(
		matched.map(
			(candidate) =>
				`${candidate.adapterKey}::${normalizeTag(candidate.upstreamModel)}`,
		),
	);

	const candidates: DeprecationCandidate[] = [];
	for (const [adapterKey, models] of catalogsByAdapter) {
		for (const [upstreamModel, entry] of Object.entries(models)) {
			if (entry.deprecated) continue;
			const key = confirmedKey(adapterKey, upstreamModel);
			if (confirmedHistory[key] === undefined) continue;
			if (presentThisRun.has(key)) continue;

			const patched: CatalogEntry = structuredClone(entry);
			patched.deprecated = true;
			const note = `auto-flagged: no longer listed by any sync source as of ${new Date().toISOString().slice(0, 10)} (last confirmed ${confirmedHistory[key]})`;
			patched.notes = patched.notes ? `${patched.notes}\n${note}` : note;

			candidates.push({
				adapterKey,
				upstreamModel,
				entry: patched,
				reason: `absent from Vercel AI Gateway and OpenRouter this run (last confirmed ${confirmedHistory[key]})`,
			});
		}
	}
	return candidates;
}
