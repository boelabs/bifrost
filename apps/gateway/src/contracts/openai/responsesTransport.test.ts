import { chatRequestSchema, toCanonicalChatRequest } from "./chat.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assertResponsesRequestSupported,
	buildResponsesRequestBody,
	parseResponsesUsage,
} from "./responsesTransport.ts";

test("Chat metadata, safety identity and user survive a Responses upstream", () => {
	const request = toCanonicalChatRequest(
		chatRequestSchema.parse({
			model: "public-model",
			messages: [{ role: "user", content: "hello" }],
			user: "user-1",
			metadata: { trace: "trace-1" },
			safety_identifier: "safety-1",
			service_tier: "default",
			prompt_cache_key: "cache-1",
		}),
	);
	const body = buildResponsesRequestBody(request, "upstream-model");
	assert.equal(body.user, "user-1");
	assert.deepEqual(body.metadata, { trace: "trace-1" });
	assert.equal(body.safety_identifier, "safety-1");
	assert.equal(body.service_tier, "default");
	assert.equal(body.prompt_cache_key, "cache-1");
	assert.equal(body.store, false);
});

test("Responses rejects Chat controls it cannot represent instead of losing them", () => {
	for (const [param, value] of [
		["n", 2],
		["stop", ["END"]],
		["seed", 42],
	] as const) {
		const request = toCanonicalChatRequest(
			chatRequestSchema.parse({
				model: "public-model",
				messages: [{ role: "user", content: "hello" }],
				[param]: value,
			}),
		);
		assert.throws(
			() => assertResponsesRequestSupported(request),
			(error: unknown) =>
				GatewayError.is(error) &&
				error.param === param &&
				error.httpStatus === 400,
		);
	}
});

test("Responses accepts single-choice Chat requests with no stop sequences", () => {
	const request = toCanonicalChatRequest(
		chatRequestSchema.parse({
			model: "public-model",
			messages: [{ role: "user", content: "hello" }],
			n: 1,
			stop: [],
		}),
	);
	assert.doesNotThrow(() => assertResponsesRequestSupported(request));
});

test("Responses usage retains reasoning and cache counts, including zero and absence", () => {
	assert.deepEqual(
		parseResponsesUsage({
			input_tokens: 20,
			output_tokens: 8,
			total_tokens: 28,
			input_tokens_details: { cached_tokens: 12 },
			output_tokens_details: { reasoning_tokens: 5 },
		}),
		{
			promptTokens: 20,
			completionTokens: 8,
			totalTokens: 28,
			cacheReadTokens: 12,
			reasoningTokens: 5,
		},
	);
	assert.equal(
		parseResponsesUsage({ output_tokens_details: { reasoning_tokens: 0 } })
			.reasoningTokens,
		0,
	);
	assert.equal(parseResponsesUsage({}).reasoningTokens, undefined);
});
