import { updateHistory, confirmedKey, type SyncHistory } from "./history.ts";
import type { MatchedCandidate } from "./match.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function empty(): SyncHistory {
	return { singleSource: {}, confirmed: {} };
}

function candidate(
	adapterKey: string,
	upstreamModel: string,
	bySource: MatchedCandidate["bySource"],
	confirmed: boolean,
): MatchedCandidate {
	return { adapterKey, upstreamModel, bySource, confirmed };
}

test("a confirmed candidate is recorded as a confirmed sighting, not a streak", () => {
	const c = candidate("openai", "gpt-5.5", {}, true);
	const next = updateHistory(empty(), [c]);
	assert.deepEqual(next.singleSource, {});
	assert.ok(next.confirmed[confirmedKey("openai", "gpt-5.5")]);
});

test("a confirmed sighting survives the model later disappearing (provenance for deprecation)", () => {
	const c = candidate("openai", "gpt-5.5", {}, true);
	const first = updateHistory(empty(), [c]);
	const second = updateHistory(first, []);
	assert.ok(second.confirmed[confirmedKey("openai", "gpt-5.5")]);
});

test("a single-source candidate starts a streak of 1", () => {
	const c = candidate(
		"openai",
		"gpt-5.5",
		{
			"vercel-ai-gateway": {
				model: {
					source: "vercel-ai-gateway",
					id: "openai/gpt-5.5",
					inputModalities: [],
					outputModalities: [],
					endpoints: [],
				},
				endpoint: undefined,
			},
		},
		false,
	);
	const next = updateHistory(empty(), [c]);
	assert.equal(
		next.singleSource["openai::gpt-5.5"]!.lastSeenSingleSourceStreak,
		1,
	);
	assert.equal(
		next.singleSource["openai::gpt-5.5"]!.lastSource,
		"vercel-ai-gateway",
	);
});

test("the same single source across two runs extends the streak", () => {
	const c = candidate(
		"openai",
		"gpt-5.5",
		{
			"vercel-ai-gateway": {
				model: {
					source: "vercel-ai-gateway",
					id: "openai/gpt-5.5",
					inputModalities: [],
					outputModalities: [],
					endpoints: [],
				},
				endpoint: undefined,
			},
		},
		false,
	);
	const first = updateHistory(empty(), [c]);
	const second = updateHistory(first, [c]);
	assert.equal(
		second.singleSource["openai::gpt-5.5"]!.lastSeenSingleSourceStreak,
		2,
	);
});

test("switching which single source reports it resets the streak", () => {
	const onVercel = candidate(
		"openai",
		"gpt-5.5",
		{
			"vercel-ai-gateway": {
				model: {
					source: "vercel-ai-gateway",
					id: "openai/gpt-5.5",
					inputModalities: [],
					outputModalities: [],
					endpoints: [],
				},
				endpoint: undefined,
			},
		},
		false,
	);
	const onOpenRouter = candidate(
		"openai",
		"gpt-5.5",
		{
			openrouter: {
				model: {
					source: "openrouter",
					id: "openai/gpt-5.5",
					inputModalities: [],
					outputModalities: [],
					endpoints: [],
				},
				endpoint: undefined,
			},
		},
		false,
	);
	const first = updateHistory(empty(), [onVercel]);
	const second = updateHistory(first, [onOpenRouter]);
	assert.equal(
		second.singleSource["openai::gpt-5.5"]!.lastSeenSingleSourceStreak,
		1,
	);
	assert.equal(
		second.singleSource["openai::gpt-5.5"]!.lastSource,
		"openrouter",
	);
});

test("a candidate no longer present in the run is dropped from single-source tracking", () => {
	const c = candidate(
		"openai",
		"gpt-5.5",
		{
			"vercel-ai-gateway": {
				model: {
					source: "vercel-ai-gateway",
					id: "openai/gpt-5.5",
					inputModalities: [],
					outputModalities: [],
					endpoints: [],
				},
				endpoint: undefined,
			},
		},
		false,
	);
	const first = updateHistory(empty(), [c]);
	assert.deepEqual(updateHistory(first, []).singleSource, {});
});
