import { responsesRequestSchema } from "#contracts/openai/responses.ts";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { MAX_RERANK_BODY_BYTES } from "#endpoints/rerank.ts";
import { parseBody, readJsonBody } from "./pipeline.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

test("rerank declares a 16 MiB pre-parse body limit", () => {
	assert.equal(MAX_RERANK_BODY_BYTES, 16 * 1024 * 1024);
});

function rejectedRequest(body: unknown): GatewayError {
	try {
		parseBody(responsesRequestSchema, body);
	} catch (error) {
		if (GatewayError.is(error)) return error;
		throw error;
	}
	throw new Error("Expected request validation to fail");
}

test("request validation exposes the field and cause for invalid scalar types", () => {
	const error = rejectedRequest({
		model: "public-model",
		input: "hello",
		max_output_tokens: "many",
	});
	assert.equal(error.param, "max_output_tokens");
	assert.match(error.publicMessage, /max_output_tokens/);
	assert.match(error.publicMessage, /expected number, received string/);
	assert.notEqual(error.publicMessage, "The request is invalid.");
});

test("request validation points a missing Responses input at input", () => {
	const error = rejectedRequest({ model: "public-model" });
	assert.equal(error.param, "input");
	assert.equal(
		error.publicMessage,
		"input: Either 'input' or 'previous_response_id' is required",
	);
});

test("limited JSON reading rejects declared and actual oversized bodies before parsing", async () => {
	const app = new Hono<AppEnv>();
	app.onError((error, c) =>
		GatewayError.is(error)
			? c.json(error.toOpenRouter(), error.httpStatus as ContentfulStatusCode)
			: c.json({}, 500),
	);
	app.post("/", async (c) => c.json(await readJsonBody(c, 4)));

	const declared = await app.request("/", {
		method: "POST",
		headers: { "content-type": "application/json", "content-length": "5" },
		body: "{}",
	});
	assert.equal(declared.status, 413);
	assert.deepEqual(await declared.json(), {
		error: { code: 413, message: "Request body exceeds the 4 byte limit." },
	});

	const actual = await app.request("/", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: '{"x":1}',
	});
	assert.equal(actual.status, 413);
});
