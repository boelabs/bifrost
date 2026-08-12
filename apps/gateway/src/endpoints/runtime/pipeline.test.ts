import type { ContentfulStatusCode } from "hono/utils/http-status";
import { MAX_RERANK_BODY_BYTES } from "#endpoints/rerank.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import { readJsonBody } from "./pipeline.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";

test("rerank declares a 16 MiB pre-parse body limit", () => {
	assert.equal(MAX_RERANK_BODY_BYTES, 16 * 1024 * 1024);
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
