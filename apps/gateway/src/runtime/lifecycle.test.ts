import assert from "node:assert/strict";
import { test } from "node:test";

import {
	resetLifecycleForTests,
	lifecyclePhase,
	drainingForMs,
	beginDraining,
	isDraining,
} from "./lifecycle.ts";

test("lifecycle starts in rotation", () => {
	resetLifecycleForTests();
	assert.equal(lifecyclePhase(), "running");
	assert.equal(isDraining(), false);
	assert.equal(drainingForMs(), null);
});

test("draining is one-way and idempotent", () => {
	resetLifecycleForTests();
	assert.equal(beginDraining(), true);
	// The second signal must not restart the clock: the drain deadline is measured from the first.
	assert.equal(beginDraining(), false);
	assert.equal(lifecyclePhase(), "draining");
	assert.equal(isDraining(), true);
	assert.ok((drainingForMs() ?? -1) >= 0);
	resetLifecycleForTests();
});
