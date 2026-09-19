import { firstOutputMsOf } from "./operations.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const startTime = new Date(1_000_000);
const input = (firstOutputMs: number | null) => ({ startTime, firstOutputMs });

test("first output: a progressive response reports when output began", () => {
	assert.equal(firstOutputMsOf(true, 1_000_450, input(null)), 450);
});

test("first output: a reported instant is used when no lifecycle observed one", () => {
	assert.equal(firstOutputMsOf(true, null, input(320)), 320);
});

test("first output: a non-progressive response has none", () => {
	// The duration an endpoint might report here answers a different question, and `durationMs`
	// already answers that one. Mixed into the same column they describe neither.
	assert.equal(firstOutputMsOf(false, null, input(2827)), null);
	// Not even a lifecycle observation overrides it: if the response was not streamed, the column
	// is not about this response.
	assert.equal(firstOutputMsOf(false, 1_000_450, input(null)), null);
});

test("first output: a progressive response that produced none stays null", () => {
	// A stream that ended without a single useful token: nothing to record, and nothing invented.
	assert.equal(firstOutputMsOf(true, null, input(null)), null);
});
