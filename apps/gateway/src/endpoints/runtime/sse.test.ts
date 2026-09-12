import assert from "node:assert/strict";
import { test } from "node:test";

import {
	markDownstreamSemanticWritten,
	markDownstreamTerminalWritten,
	newDownstreamWriteObservation,
	awaitWithSSEHeartbeats,
	writeSSEHeartbeat,
	writeSSE,
} from "./sse.ts";

test("awaitWithSSEHeartbeats keeps pre-output work alive", async () => {
	let heartbeats = 0;
	const value = await awaitWithSSEHeartbeats(
		new Promise<string>((resolve) => setTimeout(() => resolve("ready"), 25)),
		async () => {
			heartbeats += 1;
		},
		5,
	);
	assert.equal(value, "ready");
	assert.ok(heartbeats >= 2);
});

test("awaitWithSSEHeartbeats preserves rejection", async () => {
	const failure = new Error("routing failed");
	await assert.rejects(
		() =>
			awaitWithSSEHeartbeats(
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(failure), 15),
				),
				async () => {},
				5,
			),
		(error: unknown) => error === failure,
	);
});

test("downstream observation distinguishes transport, semantic, and terminal writes", async () => {
	const observation = newDownstreamWriteObservation();
	const writer = {
		async write() {},
		async writeSSE() {},
	};
	await writeSSEHeartbeat(writer, observation);
	assert.equal(observation.deliveryState, "opened");
	assert.equal(observation.writes, 1);
	assert.ok(observation.firstWriteAt !== null);
	assert.equal(observation.firstSemanticWriteAt, null);

	await writeSSE(writer, { data: "semantic" }, observation);
	markDownstreamSemanticWritten(observation);
	assert.equal(observation.deliveryState, "semantic_written");
	assert.ok(observation.firstSemanticWriteAt !== null);

	await writeSSE(writer, { data: "[DONE]" }, observation);
	markDownstreamTerminalWritten(observation);
	assert.equal(observation.deliveryState, "terminal_written");
	assert.ok(observation.terminalWriteAt !== null);
	assert.equal(observation.writes, 3);
});

test("downstream observation does not count rejected writes as delivered bytes", async () => {
	const observation = newDownstreamWriteObservation();
	const failure = new Error("closed");
	await assert.rejects(
		() =>
			writeSSE(
				{
					async write() {},
					async writeSSE() {
						throw failure;
					},
				},
				{ data: "not delivered" },
				observation,
			),
		(error: unknown) => error === failure,
	);
	assert.equal(observation.deliveryState, "write_failed");
	assert.equal(observation.bytes, 0);
	assert.equal(observation.writes, 0);
	assert.ok(observation.writeFailedAt !== null);
});
