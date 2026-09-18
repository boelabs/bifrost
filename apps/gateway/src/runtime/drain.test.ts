import assert from "node:assert/strict";
import { test } from "node:test";

import {
	TEARDOWN_TIMEOUT_MS,
	type DrainEffects,
	runDrainSequence,
	type DrainEvent,
	drainBudgetMs,
} from "./drain.ts";

interface Recorder {
	steps: string[];
	events: DrainEvent[];
	effects: DrainEffects;
}

function recorder(overrides: Partial<DrainEffects> = {}): Recorder {
	const steps: string[] = [];
	const events: DrainEvent[] = [];
	const effects: DrainEffects = {
		beginDraining: () => {
			steps.push("begin-draining");
			return true;
		},
		stopJobs: async () => {
			steps.push("stop-jobs");
		},
		releaseConnections: async ({ idleOnly }) => {
			steps.push(idleOnly ? "release-idle" : "release-all");
		},
		closeServer: async () => {
			steps.push("close-server");
		},
		closeIdleConnections: () => {
			steps.push("close-idle-connections");
		},
		closeAllConnections: () => {
			steps.push("close-all-connections");
		},
		flushLogs: async () => {
			steps.push("flush-logs");
		},
		closeDependencies: async () => {
			steps.push("close-dependencies");
		},
		sleep: async (ms) => {
			steps.push(`sleep:${ms}`);
		},
		onEvent: (event) => {
			events.push(event);
		},
		...overrides,
	};
	return { steps, events, effects };
}

const timings = { drainDelayMs: 15_000, drainTimeoutMs: 120_000 };

test("the drain announces unreadiness before it stops accepting connections", async () => {
	const { steps, effects } = recorder();
	await runDrainSequence(effects, timings);

	assert.deepEqual(steps, [
		"begin-draining",
		"stop-jobs",
		"release-idle",
		"sleep:15000",
		"close-idle-connections",
		"close-server",
		"release-all",
		"close-all-connections",
		"flush-logs",
		"close-dependencies",
	]);
});

test("the wait sits between readiness flipping and the listener closing", async () => {
	const { steps, effects } = recorder();
	await runDrainSequence(effects, timings);

	// The point of the whole sequence: nothing upstream can learn this instance is going away until
	// readiness says so, so the wait is only useful on this side of it — and the listener must stay
	// open for its whole length.
	assert.ok(steps.indexOf("begin-draining") < steps.indexOf("sleep:15000"));
	assert.ok(steps.indexOf("sleep:15000") < steps.indexOf("close-server"));
});

test("a zero delay skips the wait entirely", async () => {
	const { steps, effects } = recorder();
	await runDrainSequence(effects, { ...timings, drainDelayMs: 0 });

	assert.ok(!steps.some((step) => step.startsWith("sleep:")));
	assert.ok(steps.includes("close-server"));
});

test("idle connections are released early, busy ones only at the end", async () => {
	const { steps, effects } = recorder();
	await runDrainSequence(effects, timings);

	assert.ok(steps.indexOf("release-idle") < steps.indexOf("close-server"));
	assert.ok(steps.indexOf("release-all") > steps.indexOf("close-server"));
});

test("a second drain is refused rather than restarted", async () => {
	const { steps, events, effects } = recorder({ beginDraining: () => false });
	await runDrainSequence(effects, timings);

	assert.deepEqual(steps, []);
	assert.deepEqual(events, ["already-draining"]);
});

test("connections are forced when in-flight requests outlast the window", async () => {
	const { steps, events, effects } = recorder({
		// A request that never finishes: the listener stays open until the window closes.
		closeServer: () => new Promise<void>(() => {}),
	});
	await runDrainSequence(effects, { drainDelayMs: 0, drainTimeoutMs: 5 });

	assert.ok(events.includes("requests-timeout"));
	assert.ok(steps.includes("release-all"));
	assert.ok(steps.includes("close-all-connections"));
	assert.ok(steps.includes("close-dependencies"));
});

test("a failing phase is stepped over instead of hanging the process", async () => {
	const { steps, events, effects } = recorder({
		flushLogs: () => Promise.reject(new Error("postgres is gone")),
	});
	await runDrainSequence(effects, { ...timings, drainDelayMs: 0 });

	assert.ok(events.includes("failed"));
	assert.ok(events.includes("complete"));
	assert.ok(steps.includes("close-dependencies"));
});

test("the watchdog budget covers every phase of the sequence", () => {
	assert.ok(
		drainBudgetMs(timings) >
			timings.drainDelayMs + timings.drainTimeoutMs + TEARDOWN_TIMEOUT_MS,
	);
});
