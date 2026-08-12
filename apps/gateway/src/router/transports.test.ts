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

test("transport preference: native wire wins unless the operator configured an override", () => {
	const c = candidate();
	c.adapter.transports = {
		"images.generations": {
			supported: ["chat_completions", "responses"],
			default: "responses",
		},
	};
	assert.equal(
		resolveTransport(c, "images.generations", "chat_completions"),
		"chat_completions",
	);
	c.row.transportOverrides = { "image.generate": "responses" };
	assert.equal(
		resolveTransport(c, "images.generations", "chat_completions"),
		"responses",
	);
});
