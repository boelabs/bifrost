import type { ReasoningSpec } from "#core/reasoning.ts";
import type { Adapter, ChatHandler } from "./types.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import { validateProvider } from "./index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const fakeChat = {} as ChatHandler;

function adapterWithKinds(...kinds: ReasoningSpec["kind"][]): Adapter {
	return {
		key: "fake",
		credentials: { required: [] },
		supportedCallTypes: new Set(["chat"]),
		chat: fakeChat,
		reasoningKinds: new Set(kinds),
	};
}

function entryWithKind(kind: ReasoningSpec["kind"]): CatalogEntry {
	return {
		operations: {
			"text.generate": {
				capabilities: {
					tools: true,
					vision: false,
					reasoning: true,
					structuredOutputs: false,
				},
				reasoning: { kind, levels: ["none", "low", "high"] },
			},
		},
	};
}

test("validateProvider: catalog reasoning.kind outside the adapter set throws", () => {
	assert.throws(
		() =>
			validateProvider(adapterWithKinds("openai_effort"), {
				m: entryWithKind("gemini_level"),
			}),
		/incompatible/,
	);
});

test("validateProvider: compatible kind does not throw", () => {
	assert.doesNotThrow(() =>
		validateProvider(adapterWithKinds("openai_effort", "fixed"), {
			m: entryWithKind("openai_effort"),
		}),
	);
});

test("validateProvider: without catalog or reasoningKinds it does not validate", () => {
	assert.doesNotThrow(() =>
		validateProvider(adapterWithKinds("openai_effort"), undefined),
	);
	const adapterNoKinds: Adapter = {
		key: "x",
		credentials: { required: [] },
		supportedCallTypes: new Set(["chat"]),
		chat: fakeChat,
	};
	assert.doesNotThrow(() =>
		validateProvider(adapterNoKinds, { m: entryWithKind("gemini_budget") }),
	);
});
