import { pendingReviewEntries } from "./needsHumanReview.ts";
import type { CatalogEntry } from "./types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("an entry with a non-empty needsHumanReview marker fails validation", () => {
	const models: Record<string, CatalogEntry> = {
		"gpt-5.5": {
			operations: {},
			needsHumanReview: ["operations.text.generate.reasoning"],
		},
	};
	assert.deepEqual(pendingReviewEntries("openai", models), [
		"openai/gpt-5.5: operations.text.generate.reasoning",
	]);
});

test("an entry with an empty or absent marker passes", () => {
	const models: Record<string, CatalogEntry> = {
		"gpt-5.5": { operations: {} },
		"gpt-5.4": { operations: {}, needsHumanReview: [] },
	};
	assert.deepEqual(pendingReviewEntries("openai", models), []);
});
