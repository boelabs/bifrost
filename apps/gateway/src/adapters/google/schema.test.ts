import { toGeminiSchema, toGeminiJsonSchema } from "./schema.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("toGeminiSchema: strips $schema and additionalProperties, recursively", () => {
	const out = toGeminiSchema({
		$schema: "http://json-schema.org/draft-07/schema#",
		type: "object",
		additionalProperties: false,
		properties: {
			tags: {
				type: "array",
				additionalProperties: false,
				items: { type: "string", additionalProperties: false },
			},
		},
	});
	assert.deepEqual(out, {
		type: "object",
		properties: {
			tags: { type: "array", items: { type: "string" } },
		},
	});
});

test("toGeminiSchema: inlines $ref from $defs and definitions", () => {
	const out = toGeminiSchema({
		type: "object",
		properties: { who: { $ref: "#/$defs/person" } },
		$defs: {
			person: {
				type: "object",
				properties: { name: { type: "string" } },
				required: ["name"],
			},
		},
	});
	assert.deepEqual(out.properties, {
		who: {
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
		},
	});
	assert.equal((out as Record<string, unknown>).$defs, undefined);
});

test("toGeminiSchema: cuts self-referential $ref cycles instead of looping forever", () => {
	const out = toGeminiSchema({
		type: "object",
		properties: { child: { $ref: "#/$defs/node" } },
		$defs: {
			node: {
				type: "object",
				properties: { next: { $ref: "#/$defs/node" } },
			},
		},
	});
	const child = (out.properties as Record<string, Record<string, unknown>>)
		.child;
	const next = (child!.properties as Record<string, unknown>).next;
	// The cycle is broken at the second self-reference with a bare object.
	assert.deepEqual(next, { type: "object" });
});

test("toGeminiSchema: const becomes a single-value enum", () => {
	const out = toGeminiSchema({
		type: "object",
		properties: { kind: { type: "string", const: "user" } },
	});
	assert.deepEqual((out.properties as Record<string, unknown>).kind, {
		type: "string",
		enum: ["user"],
	});
});

test("toGeminiSchema: examples array collapses to a single example", () => {
	const out = toGeminiSchema({
		type: "string",
		examples: ["alice", "bob"],
	});
	assert.equal(out.example, "alice");
	assert.equal((out as Record<string, unknown>).examples, undefined);
});

test("toGeminiSchema: oneOf and allOf map to anyOf", () => {
	const out = toGeminiSchema({
		oneOf: [{ type: "string" }, { type: "integer" }],
	});
	assert.deepEqual(out.anyOf, [{ type: "string" }, { type: "integer" }]);
	assert.equal(out.type, undefined);
});

test("toGeminiSchema: type array with null becomes type + nullable", () => {
	const out = toGeminiSchema({
		type: "object",
		properties: { age: { type: ["integer", "null"] } },
	});
	assert.deepEqual((out.properties as Record<string, unknown>).age, {
		type: "integer",
		nullable: true,
	});
});

test("toGeminiSchema: drops unsupported format but keeps supported ones", () => {
	const out = toGeminiSchema({
		type: "object",
		properties: {
			home: { type: "string", format: "uri" },
			when: { type: "string", format: "date-time" },
			count: { type: "integer", format: "int64" },
		},
	});
	const props = out.properties as Record<string, Record<string, unknown>>;
	assert.equal(props.home!.format, undefined);
	assert.equal(props.when!.format, "date-time");
	assert.equal(props.count!.format, "int64");
});

test("toGeminiSchema: an empty schema defaults to an object type", () => {
	assert.deepEqual(toGeminiSchema({}), { type: "object" });
});

test("toGeminiSchema: preserves the supported constraint fields", () => {
	const schema = {
		type: "object",
		description: "a person",
		properties: {
			name: { type: "string", minLength: 1, maxLength: 80, pattern: "^[A-Z]" },
			score: { type: "number", minimum: 0, maximum: 100 },
			roles: {
				type: "array",
				minItems: 1,
				maxItems: 5,
				items: { type: "string" },
			},
		},
		required: ["name"],
	};
	assert.deepEqual(toGeminiSchema(schema), schema);
});

test("toGeminiJsonSchema: preserves strict object and tuple constraints", () => {
	const out = toGeminiJsonSchema({
		$schema: "http://json-schema.org/draft-07/schema#",
		type: "object",
		additionalProperties: false,
		properties: {
			queries: {
				type: "array",
				prefixItems: [{ type: "string" }],
				items: {
					type: "object",
					additionalProperties: false,
					properties: { query: { type: "string" } },
					required: ["query"],
				},
			},
		},
		required: ["queries"],
	});
	assert.deepEqual(out, {
		type: "object",
		additionalProperties: false,
		properties: {
			queries: {
				type: "array",
				prefixItems: [{ type: "string" }],
				items: {
					type: "object",
					additionalProperties: false,
					properties: { query: { type: "string" } },
					required: ["query"],
				},
			},
		},
		required: ["queries"],
	});
});

test("toGeminiJsonSchema: keeps JSON Schema nullability and formats", () => {
	assert.deepEqual(
		toGeminiJsonSchema({
			type: "object",
			properties: {
				fromUnion: { type: ["string", "null"] },
				fromNullable: { type: "integer", nullable: true },
				date: { type: "string", format: "date" },
			},
		}),
		{
			type: "object",
			properties: {
				fromUnion: { type: ["string", "null"] },
				fromNullable: { type: ["integer", "null"] },
				date: { type: "string", format: "date" },
			},
		},
	);
});
