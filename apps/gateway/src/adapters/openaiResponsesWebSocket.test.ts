import { buildResponsesWebSocketMessage } from "./openaiResponsesWebSocket.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import { openaiAdapter } from "./openai/index.ts";
import type { AdapterContext } from "./types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const request: CanonicalChatRequest = {
	callType: "chat",
	model: "public-model",
	messages: [{ role: "user", content: "new input" }],
	stream: true,
	responsesTransport: {
		rawInput: [
			{
				type: "function_call_output",
				call_id: "call_1",
				output: "result",
			},
		],
		streamOptions: { include_obfuscation: true },
	},
};

const context = {
	upstreamModel: "gpt-5.6",
	credentials: {},
	meta: {
		capabilities: { reasoning: false },
		pricing: {},
		limits: {},
	},
	transport: "responses",
	requestId: "req_1",
} as unknown as AdapterContext;

test("responses websocket upstream: OpenAI advertises a native session handler", () => {
	assert.ok(openaiAdapter.responsesWebSocket);
});

test("responses websocket upstream: builds a top-level response.create without HTTP fields", () => {
	const message = buildResponsesWebSocketMessage(request, context, {
		previousResponseId: "resp_upstream_1",
		generate: true,
	});
	assert.equal(message.type, "response.create");
	assert.equal(message.model, "gpt-5.6");
	assert.equal(message.previous_response_id, "resp_upstream_1");
	assert.equal(message.store, false);
	assert.equal("stream" in message, false);
	assert.equal("stream_options" in message, false);
	assert.equal("background" in message, false);
	assert.equal("generate" in message, false);
	assert.deepEqual(message.input, request.responsesTransport?.rawInput);
});

test("responses websocket upstream: forwards OpenAI generate:false", () => {
	const message = buildResponsesWebSocketMessage(request, context, {
		generate: false,
	});
	assert.equal(message.generate, false);
	assert.equal("previous_response_id" in message, false);
});
