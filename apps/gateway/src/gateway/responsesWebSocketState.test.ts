import type { ConnectionResponseState } from "./responsesWebSocketState.ts";
import { responsesRequestSchema } from "#contracts/openai/responses.ts";
import { inheritWarmupRequest } from "./responsesWebSocketState.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("responses websocket state: generate:false tools and instructions carry into its continuation", () => {
	const warmup = responsesRequestSchema.parse({
		model: "public",
		input: "prepared message",
		instructions: "Use the prepared policy.",
		tools: [{ type: "function", name: "lookup", parameters: {} }],
		store: false,
		stream: true,
	});
	const state: ConnectionResponseState = {
		id: "resp_warmup",
		requestInput: [],
		output: [],
		warmupRequest: warmup,
	};
	const current = responsesRequestSchema.parse({
		model: "public",
		input: "generate now",
		previous_response_id: "resp_warmup",
		stream: true,
	});
	const inherited = inheritWarmupRequest(current, state);
	assert.equal(inherited.instructions, "Use the prepared policy.");
	assert.deepEqual(inherited.tools, warmup.tools);
	assert.equal(inherited.input, "generate now");
	assert.equal(inherited.previous_response_id, "resp_warmup");
});

test("responses websocket state: explicit continuation fields override warmup defaults", () => {
	const warmup = responsesRequestSchema.parse({
		model: "public",
		input: "prepared message",
		instructions: "old",
		temperature: 0.2,
		stream: true,
	});
	const current = responsesRequestSchema.parse({
		model: "public",
		input: "generate now",
		previous_response_id: "resp_warmup",
		instructions: "new",
		temperature: 0.8,
		stream: true,
	});
	const inherited = inheritWarmupRequest(current, {
		id: "resp_warmup",
		requestInput: [],
		output: [],
		warmupRequest: warmup,
	});
	assert.equal(inherited.instructions, "new");
	assert.equal(inherited.temperature, 0.8);
});
