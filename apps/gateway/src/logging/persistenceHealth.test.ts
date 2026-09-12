import { PersistenceHealthTracker } from "./persistenceHealth.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const runtime = {
	pending: 0,
	queueDepth: 0,
	queueCapacity: 100,
	encryptedSampling: true,
};

test("persistence health recovers while retaining lifetime failure totals", () => {
	let now = 1_000;
	const tracker = new PersistenceHealthTracker(() => now);
	tracker.recordFailure();
	assert.equal(tracker.status(runtime).healthy, false);
	now += 1;
	tracker.recordSuccess();
	const recovered = tracker.status(runtime);
	assert.equal(recovered.healthy, true);
	assert.equal(recovered.failureTotal, 1);
	assert.equal(recovered.consecutiveFailures, 0);
});

test("a queue drop recovers only after a later successful persistence", () => {
	let now = 1_000;
	const tracker = new PersistenceHealthTracker(() => now);
	tracker.recordDrop();
	assert.equal(tracker.status(runtime).healthy, false);
	now += 1;
	tracker.recordSuccess();
	assert.equal(tracker.status(runtime).healthy, true);
	assert.equal(tracker.status(runtime).dropTotal, 1);
});

test("high queue pressure degrades current health", () => {
	const tracker = new PersistenceHealthTracker();
	assert.equal(tracker.status({ ...runtime, queueDepth: 80 }).healthy, false);
});

test("event ordering remains correct when the clock has millisecond ties", () => {
	const tracker = new PersistenceHealthTracker(() => 1_000);
	tracker.recordSuccess();
	tracker.recordFailure();
	assert.equal(tracker.status(runtime).healthy, false);
	tracker.recordSuccess();
	assert.equal(tracker.status(runtime).healthy, true);
});
