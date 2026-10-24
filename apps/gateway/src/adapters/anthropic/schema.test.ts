import { toAnthropicStrictSchema } from "./schema.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("toAnthropicStrictSchema: moves unsupported constraints into descriptions, recursively", () => {
	const input = {
		type: "object",
		properties: {
			title: {
				type: "string",
				description: "Short title",
				minLength: 1,
				maxLength: 80,
			},
			score: {
				type: "number",
				minimum: 0,
				maximum: 10,
				exclusiveMinimum: 0,
				exclusiveMaximum: 10,
				multipleOf: 0.5,
			},
			tags: {
				type: "array",
				description: "Labels",
				minItems: 1,
				maxItems: 5,
				items: { type: "string", enum: ["a", "b"], maxLength: 10 },
			},
			steps: {
				type: "array",
				minItems: 3,
				uniqueItems: true,
				items: {
					type: "object",
					properties: {
						at: { type: "string", format: "date-time" },
						count: { type: "integer", minimum: 1 },
					},
					required: ["at", "count"],
					additionalProperties: false,
				},
			},
			kind: { const: "report" },
			code: { type: "string", pattern: "^[A-Z]{3}$" },
		},
		required: ["title", "score", "tags", "steps", "kind", "code"],
		additionalProperties: false,
	};
	const original = structuredClone(input);

	assert.deepEqual(toAnthropicStrictSchema(input), {
		type: "object",
		properties: {
			title: {
				type: "string",
				description: "Short title\n\n{minLength: 1, maxLength: 80}",
			},
			score: {
				type: "number",
				description:
					"{minimum: 0, maximum: 10, exclusiveMinimum: 0, exclusiveMaximum: 10, multipleOf: 0.5}",
			},
			tags: {
				type: "array",
				description: "Labels\n\n{maxItems: 5}",
				minItems: 1,
				items: {
					type: "string",
					enum: ["a", "b"],
					description: "{maxLength: 10}",
				},
			},
			steps: {
				type: "array",
				minItems: 1,
				items: {
					type: "object",
					properties: {
						at: { type: "string", format: "date-time" },
						count: { type: "integer", description: "{minimum: 1}" },
					},
					required: ["at", "count"],
					additionalProperties: false,
				},
				description: "{minItems: 3, uniqueItems: true}",
			},
			kind: { const: "report" },
			code: { type: "string", pattern: "^[A-Z]{3}$" },
		},
		required: ["title", "score", "tags", "steps", "kind", "code"],
		additionalProperties: false,
	});
	assert.deepEqual(input, original);
});

test("toAnthropicStrictSchema: leaves a schema Anthropic already accepts unchanged", () => {
	const schema = {
		type: "object",
		properties: {
			query: { type: "string", description: "Search terms" },
			limit: { type: ["integer", "null"], default: null },
			mode: { type: "string", enum: ["fast", "deep"] },
			who: { $ref: "#/$defs/person" },
			ids: { type: "array", minItems: 0, items: { type: "string" } },
		},
		required: ["query", "limit", "mode", "who", "ids"],
		additionalProperties: false,
		$defs: {
			person: {
				type: "object",
				properties: { name: { type: "string", format: "email" } },
				required: ["name"],
				additionalProperties: false,
			},
		},
	};
	assert.deepEqual(toAnthropicStrictSchema(schema), schema);
});

test("toAnthropicStrictSchema: closes objects and rewrites unions and definitions", () => {
	const out = toAnthropicStrictSchema({
		$schema: "http://json-schema.org/draft-07/schema#",
		type: "object",
		properties: {
			meta: { type: "object", additionalProperties: { type: "string" } },
			open: { type: ["object", "null"], properties: {} },
			pick: { oneOf: [{ type: "string", maxLength: 3 }, { type: "null" }] },
			site: { type: "string", format: "uri-reference" },
			shape: { enum: [{ x: 1 }] },
			pair: { type: "array", items: [{ type: "string" }] },
		},
		definitions: {
			item: {
				type: "object",
				properties: { n: { type: "integer", maximum: 9 } },
			},
		},
	});
	assert.deepEqual(out, {
		type: "object",
		properties: {
			meta: { type: "object", additionalProperties: false },
			open: {
				type: ["object", "null"],
				properties: {},
				additionalProperties: false,
			},
			pick: {
				anyOf: [
					{ type: "string", description: "{maxLength: 3}" },
					{ type: "null" },
				],
			},
			site: { type: "string", description: '{format: "uri-reference"}' },
			shape: { description: '{enum: [{"x":1}]}' },
			pair: { type: "array", description: '{items: [{"type":"string"}]}' },
		},
		definitions: {
			item: {
				type: "object",
				properties: { n: { type: "integer", description: "{maximum: 9}" } },
				additionalProperties: false,
			},
		},
		additionalProperties: false,
	});
});
