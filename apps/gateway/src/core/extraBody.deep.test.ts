import { mergeExtraBodyDeep } from "./extraBody.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("extra_body deep: allows siblings under a managed container", () => {
	const body = mergeExtraBodyDeep(
		{ generationConfig: { responseModalities: ["IMAGE"] } },
		{
			generationConfig: { imageConfig: { aspectRatio: "16:9" } },
			safetySettings: [],
		},
		["generationConfig.responseModalities"],
	);
	assert.deepEqual(body, {
		generationConfig: {
			responseModalities: ["IMAGE"],
			imageConfig: { aspectRatio: "16:9" },
		},
		safetySettings: [],
	});
});

test("extra_body deep: rejects leaf collisions and prototype pollution", () => {
	assert.throws(
		() =>
			mergeExtraBodyDeep(
				{ generationConfig: { responseModalities: ["IMAGE"] } },
				{ generationConfig: { responseModalities: ["TEXT"] } },
			),
		/collides/,
	);
	const polluted = JSON.parse('{"__proto__":{"admin":true}}') as Record<
		string,
		unknown
	>;
	assert.throws(() => mergeExtraBodyDeep({}, polluted), /not allowed/);
});

test("extra_body deep: limits size and depth", () => {
	assert.throws(
		() => mergeExtraBodyDeep({}, { text: "x".repeat(70_000) }),
		/64 KiB/,
	);
	const deep: Record<string, unknown> = {};
	let cursor = deep;
	for (let i = 0; i < 14; i += 1) {
		const next: Record<string, unknown> = {};
		cursor.next = next;
		cursor = next;
	}
	assert.throws(() => mergeExtraBodyDeep({}, deep), /nesting depth/);
});
