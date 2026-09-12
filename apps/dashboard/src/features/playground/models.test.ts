import { publicApi } from "#/shared/api/client.ts";
import { afterEach, mock, test } from "node:test";
import { fetchPublicModels } from "./catalog.ts";
import assert from "node:assert/strict";

import {
	reasoningEffortsFor,
	parsePublicModels,
	parameterValues,
	capabilitiesFor,
	tunablesFor,
	supports,
} from "./models.ts";

afterEach(() => mock.restoreAll());

function model(overrides: Record<string, unknown> = {}) {
	return {
		id: "public-model",
		operations: [
			{
				id: "text.generate",
				endpoints: ["/v1/chat/completions", "/v1/responses", "/v1/messages"],
			},
		],
		text_capabilities: {
			contracts: ["chat.completions", "responses", "messages"],
			supported_parameters: [
				"temperature",
				"top_p",
				"top_k",
				"max_tokens",
				"seed",
				"stop",
				"reasoning",
				"reasoning_effort",
			],
			input_modalities: ["text", "image", "pdf"],
			parameter_constraints: { temperature: { min: 0.2, max: 0.8 } },
			reasoning_efforts: ["high", "none"],
			max_output_tokens: 512,
			...overrides,
		},
	};
}

test("parses actual operation objects and only exposes text generation models", () => {
	const models = parsePublicModels({
		data: [
			model(),
			{
				id: "image",
				operations: [
					{ id: "image.generate", endpoints: ["/v1/images/generations"] },
				],
			},
		],
	});
	assert.equal(models.length, 1);
	assert.deepEqual(models[0]?.endpoints, [
		"chat.completions",
		"responses",
		"messages",
	]);
	assert.deepEqual(models[0]?.reasoningEfforts, ["none", "high"]);
	assert.equal(models[0]?.acceptsImages, true);
});

test("effective contract and parameter availability applies separately to each endpoint", () => {
	const [parsed] = parsePublicModels({
		data: [model({ contracts: ["messages", "responses"] })],
	});
	assert.ok(parsed);
	assert.deepEqual(parsed.endpoints, ["responses", "messages"]);
	assert.equal(supports(parsed, "stop", "responses"), false);
	assert.equal(supports(parsed, "stop", "messages"), true);
	assert.equal(supports(parsed, "seed", "messages"), false);
	assert.equal(supports(parsed, "top_k", "messages"), true);
	assert.deepEqual(reasoningEffortsFor(parsed, "chat.completions"), []);
	assert.deepEqual(
		capabilitiesFor(parsed, "chat.completions").inputModalities,
		[],
	);
});

test("controls honor effective numeric limits instead of provider model-name guesses", () => {
	const [parsed] = parsePublicModels({ data: [model()] });
	assert.ok(parsed);
	const controls = tunablesFor(parsed, "responses");
	assert.deepEqual(
		controls.find((control) => control.key === "temperature"),
		{
			key: "temperature",
			label: "Temperature",
			min: 0.2,
			max: 0.8,
			step: 0.05,
			fallback: 0.8,
		},
	);
	assert.equal(
		controls.find((control) => control.key === "max_tokens")?.max,
		512,
	);
	assert.equal(
		controls.find((control) => control.key === "max_tokens")?.fallback,
		512,
	);
	assert.equal(
		controls.some((control) => control.key === "top_k"),
		false,
	);
});

test("only exposes attachment modalities supported by the selected wire contract", () => {
	const [parsed] = parsePublicModels({
		data: [
			model({ input_modalities: ["text", "image", "pdf", "audio", "video"] }),
		],
	});
	assert.ok(parsed);
	assert.deepEqual(
		capabilitiesFor(parsed, "chat.completions").inputModalities,
		["text", "image", "pdf", "audio"],
	);
	assert.deepEqual(capabilitiesFor(parsed, "responses").inputModalities, [
		"text",
		"image",
		"pdf",
	]);
});

test("discrete token limits respect effective output limits", () => {
	const [parsed] = parsePublicModels({
		data: [
			model({
				parameter_constraints: { max_tokens: { values: [0, 128, 256, 1024] } },
			}),
		],
	});
	assert.ok(parsed);
	assert.deepEqual(parameterValues(parsed, "max_tokens"), [128, 256]);
});

test("unknown optional metadata does not claim union capabilities are safe across the pool", () => {
	const [parsed] = parsePublicModels({
		data: [
			{
				id: "legacy",
				operations: model().operations,
				supported_parameters: ["temperature"],
				architecture: { input_modalities: ["image"] },
			},
		],
	});
	assert.ok(parsed);
	assert.deepEqual(parsed.supportedParameters, []);
	assert.deepEqual(parsed.reasoningEfforts, []);
	assert.equal(parsed.acceptsImages, false);
});

test("malformed responses and request errors surface rather than becoming empty model lists", async () => {
	assert.throws(() =>
		parsePublicModels({ data: [{ id: "invalid", operations: ["chat"] }] }),
	);
	assert.throws(() => parsePublicModels({}));
	assert.deepEqual(parsePublicModels({ data: [] }), []);
	mock.method(publicApi, "GET", async () => ({
		error: { error: { message: "Discovery unavailable" } },
		response: new Response(null, { status: 503 }),
	}));
	await assert.rejects(fetchPublicModels(), /Discovery unavailable/);
});

test("fetches only public model discovery and preserves successful empty responses", async () => {
	mock.method(publicApi, "GET", async (path: string) => {
		assert.equal(path, "/v1/models");
		return { data: { data: [] }, response: new Response() };
	});
	assert.deepEqual(await fetchPublicModels(), []);
});

test("a missing response body and transport failures are not mistaken for no models", async () => {
	mock.method(publicApi, "GET", async () => ({ response: new Response() }));
	await assert.rejects(fetchPublicModels(), /empty response/);
	mock.restoreAll();
	mock.method(publicApi, "GET", async () => {
		throw new Error("Network unavailable");
	});
	await assert.rejects(fetchPublicModels(), /Network unavailable/);
});

test("incompatible numeric constraints and discrete enumerations never produce invalid sliders", () => {
	const [parsed] = parsePublicModels({
		data: [
			model({
				parameter_constraints: {
					temperature: { min: 1, max: 0 },
					top_p: { values: [0.5, 1] },
				},
			}),
		],
	});
	assert.ok(parsed);
	const controls = tunablesFor(parsed, "responses");
	assert.equal(
		controls.some((control) => control.key === "temperature"),
		false,
	);
	assert.equal(
		controls.some((control) => control.key === "top_p"),
		false,
	);
});
