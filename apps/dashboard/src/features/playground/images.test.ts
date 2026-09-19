import assert from "node:assert/strict";
import type { FetchLike } from "./api";
import { test } from "node:test";

import {
	type ImageSettings,
	generationBody,
	imagesFrom,
	runImages,
	editForm,
} from "./images";

const settings: ImageSettings = {
	size: "1024x1536",
	quality: "high",
	n: 2,
	background: "transparent",
	outputFormat: "webp",
	outputCompression: 80,
	style: "vivid",
};

test("a parameter nobody chose is not sent at all", () => {
	assert.deepEqual(generationBody("gpt-image", "a fox", {}), {
		model: "gpt-image",
		prompt: "a fox",
		response_format: "b64_json",
		stream: false,
	});
});

test("chosen parameters are sent under the names the generation endpoint uses", () => {
	assert.deepEqual(generationBody("gpt-image", "a fox", settings), {
		model: "gpt-image",
		prompt: "a fox",
		size: "1024x1536",
		style: "vivid",
		quality: "high",
		n: 2,
		background: "transparent",
		output_format: "webp",
		output_compression: 80,
		response_format: "b64_json",
		stream: false,
	});
});

test("an edit carries its sources and drops the parameters that only shape a new image", () => {
	const file = new File([new Uint8Array([1, 2, 3])], "source.png", {
		type: "image/png",
	});
	const form = editForm("gpt-image", "make it snow", [file, file], settings);
	assert.equal(form.get("model"), "gpt-image");
	assert.equal(form.get("prompt"), "make it snow");
	assert.equal(form.getAll("image").length, 2);
	assert.equal(form.get("quality"), "high");
	assert.equal(form.get("output_compression"), "80");
	// The source decides the size, and DALL·E's `style` has no meaning for an edit.
	assert.equal(form.get("size"), null);
	assert.equal(form.get("style"), null);
});

test("images arrive as data URLs typed by the format the gateway reported", () => {
	assert.deepEqual(
		imagesFrom({
			data: [{ b64_json: "AAAA" }, { b64_json: "BBBB" }],
			output_format: "webp",
		}),
		[
			{ url: "data:image/webp;base64,AAAA", mediaType: "image/webp" },
			{ url: "data:image/webp;base64,BBBB", mediaType: "image/webp" },
		],
	);
	assert.deepEqual(imagesFrom({ data: [{ b64_json: "AAAA" }] }), [
		{ url: "data:image/png;base64,AAAA", mediaType: "image/png" },
	]);
	assert.deepEqual(imagesFrom({ data: [{}] }), []);
});

test("a prompt alone generates, and a prompt with sources edits", async () => {
	const calls: Array<{ url: string; multipart: boolean }> = [];
	const stub: FetchLike = async (input, init) => {
		calls.push({
			url: String(input),
			multipart: init?.body instanceof FormData,
		});
		return Response.json({ created: 1, data: [] });
	};
	const options = { fetch: stub, csrf: () => "token" };
	await runImages(
		{ model: "m", prompt: "a fox", files: [], settings: {} },
		options,
	);
	await runImages(
		{
			model: "m",
			prompt: "a fox",
			files: [new File(["x"], "a.png", { type: "image/png" })],
			settings: {},
		},
		options,
	);
	assert.deepEqual(calls, [
		{ url: "/api/v1/images/generations", multipart: false },
		{ url: "/api/v1/images/edits", multipart: true },
	]);
});

test("the gateway's own message survives a failure, instead of a bare status", async () => {
	const stub: FetchLike = async () =>
		new Response(
			JSON.stringify({ error: { message: "size is not supported" } }),
			{ status: 400, headers: { "content-type": "application/json" } },
		);
	await assert.rejects(
		runImages(
			{ model: "m", prompt: "a fox", files: [], settings: {} },
			{ fetch: stub, csrf: () => undefined },
		),
		/size is not supported/,
	);
});
