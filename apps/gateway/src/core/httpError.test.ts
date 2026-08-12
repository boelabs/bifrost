import assert from "node:assert/strict";
import { test } from "node:test";

import {
	looksLikeContextWindowError,
	describeUnknownError,
	parseRetryAfter,
	classifyStatus,
	isAbortError,
} from "./httpError.ts";

test("classifyStatus: every upstream 4xx is non-transient unless explicitly classified", () => {
	for (const status of [402, 409, 413, 415, 425, 451])
		assert.equal(classifyStatus(status), "bad_request");
	assert.equal(classifyStatus(429), "rate_limit");
	assert.equal(classifyStatus(503), "server");
});

test("parseRetryAfter: supports delta seconds and HTTP dates", () => {
	assert.equal(parseRetryAfter("1.5"), 1500);
	assert.equal(
		parseRetryAfter("Wed, 21 Oct 2015 07:28:01 GMT", 1_445_412_480_000),
		1000,
	);
	assert.equal(parseRetryAfter("invalid"), undefined);
});

test("looksLikeContextWindowError: detects known provider phrases", () => {
	// OpenAI
	assert.ok(
		looksLikeContextWindowError(
			"This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens.",
		),
	);
	// Anthropic
	assert.ok(
		looksLikeContextWindowError(
			"prompt is too long: 250000 tokens > 200000 maximum",
		),
	);
	// Gemini
	assert.ok(
		looksLikeContextWindowError(
			"The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).",
		),
	);
	// Kimi / Moonshot
	assert.ok(looksLikeContextWindowError("Input token length too long"));
	assert.ok(
		looksLikeContextWindowError(
			"Your request exceeded model token limit : 262144",
		),
	);
	// generic
	assert.ok(
		looksLikeContextWindowError("Please reduce the length of the messages."),
	);
	assert.ok(looksLikeContextWindowError("context window exceeded"));
});

test("looksLikeContextWindowError: does not mark unrelated errors", () => {
	assert.equal(looksLikeContextWindowError(undefined), false);
	assert.equal(looksLikeContextWindowError(""), false);
	assert.equal(looksLikeContextWindowError("invalid api key"), false);
	assert.equal(
		looksLikeContextWindowError("temperature must be between 0 and 2"),
		false,
	);
	// A bare "token" must NOT trigger (the previous heuristic was too broad).
	assert.equal(
		looksLikeContextWindowError("invalid token in 'stop' parameter"),
		false,
	);
});

test("isAbortError: detects AbortError/TimeoutError even when not instanceof Error", () => {
	assert.equal(isAbortError(new DOMException("x", "AbortError")), true);
	assert.equal(isAbortError({ name: "TimeoutError" }), true); // plain object (unusual runtime)
	assert.equal(isAbortError(new Error("boom")), false);
	assert.equal(isAbortError("nope"), false);
});

test("describeUnknownError: does not lose real error detail", () => {
	const withCause = new Error("fetch failed", {
		cause: new Error("ECONNRESET"),
	});
	const d = describeUnknownError(withCause);
	assert.equal(d.message, "fetch failed");
	assert.equal((d.body as Record<string, unknown>).cause, "ECONNRESET"); // the real cause is preserved

	// Non-Error thrown value: serialized instead of becoming "unknown".
	const nonErr = describeUnknownError({ weird: true });
	assert.equal(typeof nonErr.message, "string");
	assert.equal(
		(nonErr.body as Record<string, unknown>).value,
		"[object Object]",
	);
});
