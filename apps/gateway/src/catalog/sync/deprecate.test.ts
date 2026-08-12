import type { CatalogEntry } from "#catalog/types.ts";
import type { SourceFetchResult } from "./types.ts";
import type { MatchedCandidate } from "./match.ts";
import { findDeprecations } from "./deprecate.ts";
import { confirmedKey } from "./history.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function completeResults(): SourceFetchResult[] {
	return [
		{
			source: "vercel-ai-gateway",
			models: [],
			attempted: 10,
			failed: [],
			complete: true,
		},
		{
			source: "openrouter",
			models: [],
			attempted: 10,
			failed: [],
			complete: true,
		},
	];
}

function trackedEntry(): CatalogEntry {
	return { operations: {}, deprecated: false };
}

function confirmedHistoryFor(
	adapterKey: string,
	upstreamModel: string,
): Record<string, string> {
	return { [confirmedKey(adapterKey, upstreamModel)]: "2026-07-01" };
}

test("a previously confirmed entry absent from both sources this run is flagged, not deleted", () => {
	const catalogs = new Map([["openai", { "old-model": trackedEntry() }]]);
	const candidates = findDeprecations(
		catalogs,
		[],
		completeResults(),
		confirmedHistoryFor("openai", "old-model"),
	);
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0]!.entry.deprecated, true);
	assert.ok(candidates[0]!.entry.operations); // still present, untouched shape
});

test("an entry still present in this run's matches is never deprecated", () => {
	const catalogs = new Map([["openai", { "gpt-5.5": trackedEntry() }]]);
	const matched: MatchedCandidate[] = [
		{
			adapterKey: "openai",
			upstreamModel: "gpt-5.5",
			bySource: {},
			confirmed: false,
		},
	];
	assert.deepEqual(
		findDeprecations(
			catalogs,
			matched,
			completeResults(),
			confirmedHistoryFor("openai", "gpt-5.5"),
		),
		[],
	);
});

test("a hand-curated entry never confirmed in the history is never deprecated", () => {
	const catalogs = new Map([
		["openai", { "custom-model": { operations: {} } as CatalogEntry }],
	]);
	assert.deepEqual(findDeprecations(catalogs, [], completeResults(), {}), []);
});

test("an already-deprecated entry is not flagged again", () => {
	const entry = trackedEntry();
	entry.deprecated = true;
	const catalogs = new Map([["openai", { "old-model": entry }]]);
	assert.deepEqual(
		findDeprecations(
			catalogs,
			[],
			completeResults(),
			confirmedHistoryFor("openai", "old-model"),
		),
		[],
	);
});

test("an incomplete fetch this run skips deprecation entirely", () => {
	const catalogs = new Map([["openai", { "old-model": trackedEntry() }]]);
	const incomplete: SourceFetchResult[] = [
		{
			source: "vercel-ai-gateway",
			models: [],
			attempted: 10,
			failed: ["x"],
			complete: false,
		},
		{
			source: "openrouter",
			models: [],
			attempted: 10,
			failed: [],
			complete: true,
		},
	];
	assert.deepEqual(
		findDeprecations(
			catalogs,
			[],
			incomplete,
			confirmedHistoryFor("openai", "old-model"),
		),
		[],
	);
});
