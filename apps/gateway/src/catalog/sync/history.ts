import { readFileSync, writeFileSync } from "node:fs";
import { normalizeTag } from "./providerIdentity.ts";
import type { MatchedCandidate } from "./match.ts";

export interface HistoryEntry {
	/** Consecutive `report` runs this candidate has been seen on exactly one existence source. */
	lastSeenSingleSourceStreak: number;
	lastSource: string | null;
	reason: string | null;
	lastUpdated: string;
}

export interface SyncHistory {
	/** Keyed by "adapterKey::upstreamModel" (raw, for readability in the file). */
	singleSource: Record<string, HistoryEntry>;
	/**
	 * "adapterKey::normalizedModel" -> last date BOTH existence sources listed it. This is the sync's
	 * provenance record (catalog entries deliberately carry none): deprecation candidates are only ever
	 * models that appear here from a PREVIOUS run and are absent now - a hand-curated model the
	 * aggregators never listed can't be flagged, because it never enters this map.
	 */
	confirmed: Record<string, string>;
}

export function confirmedKey(
	adapterKey: string,
	upstreamModel: string,
): string {
	return `${adapterKey}::${normalizeTag(upstreamModel)}`;
}

const EMPTY: SyncHistory = { singleSource: {}, confirmed: {} };

export function loadHistory(url: URL): SyncHistory {
	try {
		const parsed = JSON.parse(
			readFileSync(url, "utf8"),
		) as Partial<SyncHistory>;
		// Tolerates a missing/older file shape by starting fresh - this is a local advisory cache, not data.
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			typeof parsed.confirmed !== "object" ||
			typeof parsed.singleSource !== "object"
		) {
			return structuredClone(EMPTY);
		}
		return {
			singleSource: parsed.singleSource ?? {},
			confirmed: parsed.confirmed ?? {},
		};
	} catch (err) {
		if ((err as { code?: unknown }).code === "ENOENT")
			return structuredClone(EMPTY);
		throw err;
	}
}

export function writeHistory(url: URL, history: SyncHistory): void {
	writeFileSync(url, `${JSON.stringify(history, null, "\t")}\n`);
}

/**
 * `singleSource` is recomputed from scratch each run (not merged in place): a candidate that becomes
 * confirmed, or stops appearing at all, has nothing more to track and is dropped rather than carrying
 * forward a stale streak. Only candidates still single-source THIS run keep or extend their streak - lets
 * the report distinguish "first time we've only seen this on one source" from "N consecutive runs
 * single-source," a much stronger signal for a reviewer to act on than a one-off gap.
 *
 * `confirmed` is append/refresh-only: once a model has been confirmed by both sources, that fact must
 * survive the model later disappearing - it's exactly what findDeprecations needs to distinguish "gone
 * from upstream" from "never listed upstream."
 */
export function updateHistory(
	previous: SyncHistory,
	matched: readonly MatchedCandidate[],
): SyncHistory {
	const next: SyncHistory = {
		singleSource: {},
		confirmed: { ...previous.confirmed },
	};
	const today = new Date().toISOString().slice(0, 10);
	for (const candidate of matched) {
		if (candidate.confirmed) {
			next.confirmed[
				confirmedKey(candidate.adapterKey, candidate.upstreamModel)
			] = today;
			continue;
		}
		const sources = Object.keys(candidate.bySource);
		const singleSource = sources[0] ?? null;
		const key = `${candidate.adapterKey}::${candidate.upstreamModel}`;
		const prior = previous.singleSource[key];
		const streak =
			prior && prior.lastSource === singleSource
				? prior.lastSeenSingleSourceStreak + 1
				: 1;
		next.singleSource[key] = {
			lastSeenSingleSourceStreak: streak,
			lastSource: singleSource,
			reason: singleSource ? `only reported by ${singleSource}` : null,
			lastUpdated: today,
		};
	}
	return next;
}
