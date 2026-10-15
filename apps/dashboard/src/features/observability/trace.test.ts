import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
	formatDuration,
	isOperationId,
	formatBytes,
	causeLabel,
	phaseLabel,
	percentOf,
	shortId,
} from "./trace.ts";

describe("formatDuration", () => {
	test("reads at the scale of the value", () => {
		assert.equal(formatDuration(null), "—");
		assert.equal(formatDuration(42), "42 ms");
		assert.equal(formatDuration(1520), "1.52 s");
		assert.equal(formatDuration(42_100), "42.1 s");
		assert.equal(formatDuration(630_000), "10m 30s");
	});
});

test("formatBytes", () => {
	assert.equal(formatBytes(512), "512 B");
	assert.equal(formatBytes(2048), "2.0 KB");
	assert.equal(formatBytes(undefined), "—");
});

describe("causeLabel", () => {
	test("names whose failure it was and what the provider said", () => {
		assert.equal(
			causeLabel({
				owner: "provider",
				kind: "upstream_server",
				providerStatus: 503,
			}),
			"Upstream 503 · server error",
		);
		assert.equal(
			causeLabel({ owner: "gateway_deadline", phase: "stream" }),
			"Deadline · mid-stream",
		);
		assert.equal(
			causeLabel({ owner: "client", kind: "bad_request", providerStatus: 400 }),
			"Rejected 400 · bad request",
		);
		assert.equal(
			causeLabel({ owner: "client", kind: "cancelled" }),
			"Client left",
		);
		assert.equal(
			causeLabel({ owner: "provider", kind: "truncated" }),
			"Upstream · stream cut",
		);
		assert.equal(causeLabel(null), "—");
	});

	test("phases recorded before they were explicit still read", () => {
		assert.equal(phaseLabel("first_progress"), "first output");
		assert.equal(phaseLabel("streaming"), "response");
	});
});

test("percentOf clamps to the bar", () => {
	assert.equal(percentOf(50, 200), 25);
	assert.equal(percentOf(500, 200), 100);
	assert.equal(percentOf(-1, 200), 0);
	assert.equal(percentOf(1, 0), 0);
});

test("an operation is named by its UUID", () => {
	const id = "0192f4c1-7a2b-7c3d-8e4f-5a6b7c8d9e0f";
	assert.equal(isOperationId(id), true);
	assert.equal(isOperationId(id.toUpperCase()), true);
	assert.equal(isOperationId("not-an-id"), false);
	assert.equal(isOperationId(`${id}x`), false);
	assert.equal(shortId(id), "0192f4c1");
});
