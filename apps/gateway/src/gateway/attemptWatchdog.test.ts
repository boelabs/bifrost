import { startAttemptWatchdog } from "./attemptWatchdog.ts";
import type { GatewayAbortReason } from "./abortReason.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const wait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function recorder() {
	const reasons: GatewayAbortReason[] = [];
	return {
		reasons,
		abort: (reason: GatewayAbortReason) => reasons.push(reason),
	};
}

test("json: the response deadline covers the whole body", async () => {
	const { reasons, abort } = recorder();
	const watchdog = startAttemptWatchdog(
		{ responseMs: 20, idleMs: null },
		"json",
		abort,
	);
	// Headers alone do not end it: a JSON answer is not there until its body is.
	watchdog.headers();
	await wait(40);
	assert.deepEqual(reasons, [
		{ owner: "gateway", type: "timeout", phase: "response" },
	]);
	watchdog.stop();
});

test("json: a complete body ends every deadline", async () => {
	const { reasons, abort } = recorder();
	const watchdog = startAttemptWatchdog(
		{ responseMs: 20, idleMs: null },
		"json",
		abort,
	);
	watchdog.complete();
	await wait(40);
	assert.deepEqual(reasons, []);
});

test("stream: headers end the response deadline and start watching for silence", async () => {
	const { reasons, abort } = recorder();
	const watchdog = startAttemptWatchdog(
		{ responseMs: 20, idleMs: 60 },
		"stream",
		abort,
	);
	watchdog.headers();
	// Bytes keep arriving for longer than the response deadline and the idle window together.
	for (let i = 0; i < 6; i++) {
		await wait(20);
		watchdog.bytes();
	}
	assert.deepEqual(reasons, []);
	await wait(100);
	assert.deepEqual(reasons, [
		{ owner: "gateway", type: "timeout", phase: "idle" },
	]);
	watchdog.stop();
});

test("stream: no idle deadline when it is disabled", async () => {
	const { reasons, abort } = recorder();
	const watchdog = startAttemptWatchdog(
		{ responseMs: 20, idleMs: null },
		"stream",
		abort,
	);
	watchdog.headers();
	await wait(50);
	assert.deepEqual(reasons, []);
	watchdog.stop();
});

test("stream: no headers within the response deadline aborts the attempt", async () => {
	const { reasons, abort } = recorder();
	const watchdog = startAttemptWatchdog(
		{ responseMs: 15, idleMs: 1000 },
		"stream",
		abort,
	);
	await wait(40);
	assert.deepEqual(reasons, [
		{ owner: "gateway", type: "timeout", phase: "response" },
	]);
	watchdog.stop();
});
