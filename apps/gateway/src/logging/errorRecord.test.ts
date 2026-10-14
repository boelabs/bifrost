import assert from "node:assert/strict";
import { test } from "node:test";

import {
	providerErrorDetail,
	internalMessage,
	scrubSecrets,
} from "./errorRecord.ts";

test("credential-shaped strings never reach the log", () => {
	const scrubbed = scrubSecrets(
		'Incorrect API key provided: sk-proj-abcdefghijklmnop. Header was "Bearer eyJhbGciOiJIUzI1NiJ9.x.y", api_key=AIzaSyA1234567890abcdefghij',
	);
	assert.doesNotMatch(scrubbed, /abcdefghijklmnop|eyJhbGci|AIzaSy/);
	assert.match(scrubbed, /Incorrect API key provided/);
});

test("reads the provider's own error from the shapes providers use", () => {
	assert.deepEqual(
		providerErrorDetail(
			{
				error: {
					message: "Invalid value for 'temperature'",
					type: "invalid_request_error",
					param: "temperature",
					code: "invalid_value",
				},
			},
			true,
		),
		{
			type: "invalid_request_error",
			code: "invalid_value",
			param: "temperature",
			message: "Invalid value for 'temperature'",
		},
	);
	// Anthropic.
	assert.deepEqual(
		providerErrorDetail(
			{
				type: "error",
				error: { type: "overloaded_error", message: "Overloaded" },
			},
			true,
		),
		{ type: "overloaded_error", message: "Overloaded" },
	);
	// Google.
	assert.deepEqual(
		providerErrorDetail(
			{ error: { code: 503, status: "UNAVAILABLE", message: "busy" } },
			true,
		),
		{ type: "UNAVAILABLE", code: "503", message: "busy" },
	);
	assert.deepEqual(providerErrorDetail("upstream exploded", true), {
		message: "upstream exploded",
	});
	assert.equal(providerErrorDetail(undefined, true), null);
});

test("a sealed deployment keeps the structure but not the text", () => {
	assert.deepEqual(
		providerErrorDetail(
			{
				error: { message: "your prompt said X", type: "invalid_request_error" },
			},
			false,
		),
		{ type: "invalid_request_error" },
	);
	assert.equal(providerErrorDetail("plain text", false), null);
	assert.deepEqual(internalMessage("OpenAI: boom", false), {});
	assert.deepEqual(internalMessage("OpenAI: boom", true), {
		message: "OpenAI: boom",
	});
});

test("messages are bounded", () => {
	const long = internalMessage("x".repeat(5000), true) as { message: string };
	assert.equal(long.message.length, 2000);
});
