import type { DeploymentCandidate } from "#gateway/deploymentCandidates.ts";
import { resolveTransport } from "./transport.ts";
import { encryptJson } from "#db/crypto.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function candidate(): DeploymentCandidate {
	return {
		row: {
			id: "00000000-0000-0000-0000-000000000001",
			publicModel: "image",
			adapterKey: "fake",
			upstreamModel: "image",
			credentials: encryptJson({}, "deployment-credentials"),
			label: null,
			failureDomain: null,
			metadata: {},
			catalogEntry: null,
			pricing: null,
			transportOverrides: {},
			executionPolicyOverrides: {},
			enabled: true,
			weight: 1,
			tpmLimit: null,
			rpmLimit: null,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		},
		upstreamModel: "image",
		meta: {
			capabilities: {
				tools: false,
				vision: true,
				reasoning: false,
				structuredOutputs: false,
			},
			supportedCallTypes: ["images.generations"],
		},
		adapter: {
			key: "fake",
			credentials: { required: [] },
			supportedCallTypes: new Set(),
			transports: {
				"images.generations": {
					supported: ["images", "chat_completions"],
					default: "images",
				},
			},
		},
	};
}

test("transport per operation: deployment override > adapter default", () => {
	const c = candidate();
	assert.equal(resolveTransport(c, "images.generations"), "images");
	c.row.transportOverrides = { "image.generate": "chat_completions" };
	assert.equal(resolveTransport(c, "images.generations"), "chat_completions");
});

test("transport per operation: incompatible config fails explicitly", () => {
	const c = candidate();
	c.row.transportOverrides = { "image.generate": "responses" };
	assert.throws(
		() => resolveTransport(c, "images.generations"),
		/does not support/,
	);
});

test("text generation uses the adapter default until a deployment overrides it", () => {
	const c = candidate();
	c.adapter.transports = {
		chat: {
			supported: ["chat_completions", "responses"],
			default: "responses",
		},
	};
	assert.equal(resolveTransport(c, "chat"), "responses");
	c.row.transportOverrides = { "text.generate": "chat_completions" };
	assert.equal(resolveTransport(c, "chat"), "chat_completions");
});

test("a model that declares its transport outranks the adapter default", () => {
	const c = candidate();
	c.meta.operations = {
		"image.generate": { transport: "chat_completions", maxN: 1 },
	};
	assert.equal(resolveTransport(c, "images.generations"), "chat_completions");
});

test("an operator override still outranks what the model declares", () => {
	const c = candidate();
	c.meta.operations = {
		"image.generate": { transport: "chat_completions", maxN: 1 },
	};
	c.row.transportOverrides = { "image.generate": "images" };
	assert.equal(resolveTransport(c, "images.generations"), "images");
});

test("a declared transport the adapter cannot run names the model, not a setting", () => {
	const c = candidate();
	c.meta.operations = {
		"image.generate": { transport: "responses", maxN: 1 },
	};
	assert.throws(
		() => resolveTransport(c, "images.generations"),
		(error: Error) => {
			assert.match(error.message, /declares transport "responses"/);
			assert.match(error.message, /"image"/);
			// The operator has configured nothing here; saying otherwise sends them hunting.
			assert.doesNotMatch(error.message, /is configured with/);
			return true;
		},
	);
});

test("nothing declared or configured falls back, and says so when it cannot run", () => {
	const c = candidate();
	c.adapter.transports = {
		"images.generations": {
			supported: ["chat_completions"],
			default: "images",
		},
	};
	assert.throws(
		() => resolveTransport(c, "images.generations"),
		/falls back to the default transport "images"/,
	);
});
