import { type CreateDeploymentInput, isKnownUpstreamModel } from "./common";
import { afterEach, mock, test } from "node:test";
import { api } from "#/shared/api/client.ts";
import assert from "node:assert/strict";
import { saveDeployment } from "./api";

afterEach(() => mock.restoreAll());

const body: CreateDeploymentInput = {
	publicModel: "test-model",
	adapterKey: "openai",
	upstreamModel: "test-upstream",
	credentials: { apiKey: "test-only" },
	weight: 2,
	metadata: { team: "test" },
	pricing: { inputCentsPerMTokens: 1 },
	transportOverrides: { "text.generate": "responses" },
};

test("saving waits for resolution and sends only capability fields to validate", async () => {
	const paths: string[] = [];
	let release: (() => void) | undefined;
	const validation = new Promise<void>((resolve) => {
		release = resolve;
	});
	mock.method(api, "POST", async (path: string, options: { body: unknown }) => {
		paths.push(path);
		if (path.endsWith("/resolve")) {
			assert.deepEqual(options.body, {
				publicModel: body.publicModel,
				adapterKey: body.adapterKey,
				upstreamModel: body.upstreamModel,
				pricing: body.pricing,
				transportOverrides: body.transportOverrides,
			});
			await validation;
		} else assert.deepEqual(options.body, body);
		return { data: { data: { id: "saved" } }, response: new Response() };
	});
	const saving = saveDeployment(body);
	assert.deepEqual(paths, ["/admin/deployments/resolve"]);
	assert.ok(release);
	release();
	await saving;
	assert.deepEqual(paths, ["/admin/deployments/resolve", "/admin/deployments"]);
});

test("failed validation prevents both creation and updates", async () => {
	const post = mock.method(api, "POST", async () => ({
		error: { error: { message: "Invalid configuration" } },
		response: new Response(null, { status: 400 }),
	}));
	const patch = mock.method(api, "PATCH", async () => {
		throw new Error("Must not save");
	});
	await assert.rejects(saveDeployment(body), /Invalid configuration/);
	await assert.rejects(
		saveDeployment(body, "existing"),
		/Invalid configuration/,
	);
	assert.equal(post.mock.callCount(), 2);
	assert.equal(patch.mock.callCount(), 0);
});

test("editing validates first and preserves stored credentials when fields are blank", async () => {
	const calls: string[] = [];
	mock.method(api, "POST", async () => {
		calls.push("resolve");
		return { data: { data: {} }, response: new Response() };
	});
	mock.method(
		api,
		"PATCH",
		async (
			_path: string,
			options: {
				body: Record<string, unknown>;
				params: { path: { id: string } };
			},
		) => {
			calls.push("update");
			assert.equal(options.params.path.id, "existing");
			assert.equal("credentials" in options.body, false);
			assert.equal("adapterKey" in options.body, false);
			assert.equal(options.body.weight, 2);
			assert.deepEqual(
				options.body.transportOverrides,
				body.transportOverrides,
			);
			return { data: { data: { id: "existing" } }, response: new Response() };
		},
	);
	await saveDeployment({ ...body, credentials: {} }, "existing");
	assert.deepEqual(calls, ["resolve", "update"]);
});

test("custom catalog entries and changed credentials reach the appropriate requests", async () => {
	const catalogEntry = {
		operations: {
			"text.generate": {
				capabilities: {
					tools: false,
					vision: false,
					reasoning: false,
					structuredOutputs: false,
				},
			},
		},
	};
	mock.method(
		api,
		"POST",
		async (_path: string, options: { body: Record<string, unknown> }) => {
			assert.deepEqual(options.body.catalogEntry, catalogEntry);
			assert.equal("credentials" in options.body, false);
			return { data: { data: {} }, response: new Response() };
		},
	);
	mock.method(
		api,
		"PATCH",
		async (_path: string, options: { body: Record<string, unknown> }) => {
			assert.deepEqual(options.body.credentials, body.credentials);
			assert.deepEqual(options.body.catalogEntry, catalogEntry);
			return { data: { data: { id: "existing" } }, response: new Response() };
		},
	);
	await saveDeployment({ ...body, catalogEntry }, "existing");
});

test("save failures propagate after successful validation", async () => {
	mock.method(api, "POST", async (path: string) =>
		path.endsWith("/resolve")
			? { data: { data: {} }, response: new Response() }
			: {
					error: { error: { message: "Could not create" } },
					response: new Response(null, { status: 500 }),
				},
	);
	await assert.rejects(saveDeployment(body), /Could not create/);
});

test("editing sends explicit resets for omitted configuration after validating the same effective body", async () => {
	const {
		pricing: _pricing,
		transportOverrides: _transports,
		...catalogBody
	} = body;
	mock.method(
		api,
		"POST",
		async (_path: string, options: { body: Record<string, unknown> }) => {
			assert.equal("catalogEntry" in options.body, false);
			assert.equal("pricing" in options.body, false);
			assert.equal("transportOverrides" in options.body, false);
			return { data: { data: {} }, response: new Response() };
		},
	);
	mock.method(
		api,
		"PATCH",
		async (_path: string, options: { body: Record<string, unknown> }) => {
			assert.equal(options.body.catalogEntry, null);
			assert.equal(options.body.pricing, null);
			assert.deepEqual(options.body.transportOverrides, {});
			return { data: { data: {} }, response: new Response() };
		},
	);
	await saveDeployment(catalogBody, "custom-to-catalog");
});

test("custom inference follows the adapter catalog including snapshot aliases", () => {
	const models = [{ id: "gpt-4.1", operations: ["text.generate"] }];
	assert.equal(isKnownUpstreamModel([], "anything"), false);
	assert.equal(isKnownUpstreamModel(models, ""), false);
	assert.equal(isKnownUpstreamModel(models, " gpt-4.1 "), true);
	assert.equal(isKnownUpstreamModel(models, "gpt-4.1-2026-04-23"), true);
	assert.equal(isKnownUpstreamModel(models, "gpt-4.1-04-2026"), true);
	assert.equal(isKnownUpstreamModel(models, "gpt-4.1-nano"), false);
	assert.equal(isKnownUpstreamModel(models, "other-model"), false);
});
