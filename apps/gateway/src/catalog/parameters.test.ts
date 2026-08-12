import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { ResolvedModelMetadata } from "./types.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	applyUnsupportedParameterPolicy,
	assertSupportedChatParameters,
	supportedParameterNames,
} from "./parameters.ts";

const meta: ResolvedModelMetadata = {
	capabilities: {
		tools: false,
		vision: true,
		reasoning: true,
		structuredOutputs: false,
	},
	reasoning: { kind: "fixed", levels: ["medium"] },
	operations: {
		"text.generate": {
			parameters: {
				temperature: false,
				top_k: { mode: "unsupported" },
				verbosity: { mode: "ignored" },
				reasoning: true,
				stop: true,
			},
		},
	},
};

function request(): CanonicalChatRequest {
	return {
		callType: "chat",
		model: "public",
		messages: [{ role: "user", content: "hi" }],
		stream: false,
		temperature: 0.2,
		topP: 0.9,
		stop: ["done"],
		reasoning: { effort: "medium" },
		extraBody: {
			top_k: 40,
			repetition_penalty: 1.1,
		},
		responsesTransport: {
			text: { verbosity: "high" },
			topLogprobs: 3,
		},
	};
}

test("supportedParameterNames combines defaults, capabilities, and explicit overrides", () => {
	const names = supportedParameterNames(meta);
	assert.equal(names.includes("temperature"), false);
	assert.equal(names.includes("top_k"), false);
	assert.equal(names.includes("verbosity"), false);
	assert.equal(names.includes("tools"), false);
	assert.equal(names.includes("tool_choice"), false);
	assert.equal(names.includes("reasoning"), true);
	assert.equal(names.includes("stop"), true);
});

test("drop policy removes only explicitly unsupported parameters", () => {
	const result = applyUnsupportedParameterPolicy(request(), meta, "drop");
	assert.deepEqual(result.droppedParameters, [
		"temperature",
		"top_k",
		"verbosity",
	]);
	assert.equal(result.request.temperature, undefined);
	assert.equal(result.request.topP, 0.9);
	assert.deepEqual(result.request.extraBody, { repetition_penalty: 1.1 });
	assert.deepEqual(result.request.responsesTransport, { topLogprobs: 3 });
});

test("error policy raises a public bad_request", () => {
	assert.throws(
		() => assertSupportedChatParameters(request(), meta),
		(error) =>
			GatewayError.is(error) &&
			error.class === "bad_request" &&
			error.code === "unsupported_parameter",
	);
});

test("allow policy leaves unsupported parameters untouched", () => {
	const req = request();
	const result = applyUnsupportedParameterPolicy(req, meta, "allow");
	assert.equal(result.request, req);
	assert.deepEqual(result.unsupportedParameters, [
		"temperature",
		"top_k",
		"verbosity",
	]);
	assert.deepEqual(result.droppedParameters, []);
});
