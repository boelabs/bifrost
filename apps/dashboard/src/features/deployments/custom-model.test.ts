import assert from "node:assert/strict";
import { test } from "node:test";

import {
	initialCustomEntry,
	selectedTransports,
	operationTemplate,
	parseCustomEntry,
	updateProfile,
	parseObject,
} from "./custom-model";

test("guided templates cover every operation without enabling speculative text capabilities", () => {
	const text = initialCustomEntry(["embedding.create", "text.generate"]);
	assert.deepEqual(text.operations["text.generate"], {
		capabilities: {
			tools: false,
			vision: false,
			reasoning: false,
			structuredOutputs: false,
		},
	});
	for (const id of [
		"text.generate",
		"image.generate",
		"image.edit",
		"video.generate",
		"audio.transcribe",
		"embedding.create",
		"rerank",
	]) {
		assert.deepEqual(
			parseCustomEntry(
				JSON.stringify({ operations: { [id]: operationTemplate(id) } }),
			).operations[id],
			operationTemplate(id),
		);
	}
	assert.deepEqual(initialCustomEntry(["embedding.create"]), {
		operations: { "embedding.create": {} },
	});
	assert.throws(() => operationTemplate("unknown"), /Unsupported operation/);
});

test("technical round trips and guided edits preserve advanced properties", () => {
	const entry = {
		operations: {
			"text.generate": {
				...operationTemplate("text.generate"),
				parameters: { temperature: { mode: "range", max: 1 } },
				modalities: { input: ["text", "pdf"] },
				maxInputTokens: 100,
			},
		},
		notes: "Keep these settings",
		pricing: { inputCentsPerMTokens: 5 },
	};
	const parsed = parseCustomEntry(JSON.stringify(entry));
	assert.deepEqual(parsed, entry);
	const changed = updateProfile(parsed, "text.generate", {
		maxOutputTokens: 20,
		maxInputTokens: undefined,
	});
	assert.deepEqual(
		changed.operations["text.generate"]?.parameters,
		entry.operations["text.generate"].parameters,
	);
	assert.equal(changed.operations["text.generate"]?.maxOutputTokens, 20);
	assert.equal(
		"maxInputTokens" in (changed.operations["text.generate"] ?? {}),
		false,
	);
	assert.equal(changed.notes, entry.notes);
	assert.deepEqual(changed.pricing, entry.pricing);
});

test("malformed technical configuration fails explicitly", () => {
	for (const text of [
		"",
		"null",
		"[]",
		"{}",
		'{"operations":{}}',
		'{"operations":{"text.generate":null}}',
	])
		assert.throws(() => parseCustomEntry(text));
	assert.throws(() => parseCustomEntry("{"), /not valid JSON/);
	assert.throws(() => parseObject("[]", "Metadata"), /must be a JSON object/);
	assert.equal(parseObject(" ", "Metadata"), undefined);
});

test("only enabled custom operations send transport overrides", () => {
	assert.deepEqual(
		selectedTransports(initialCustomEntry(["text.generate"]), {
			"text.generate": "chat_completions",
			"image.generate": "images",
		}),
		{ "text.generate": "chat_completions" },
	);
});
