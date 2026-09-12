/**
 * Translate a JSON Schema (draft-07, as emitted by zod-to-json-schema and the OpenAI / AI-SDK
 * clients) into Gemini's `Schema` object — a closed subset of OpenAPI 3.0 used by
 * `functionDeclarations[].parameters`.
 *
 * Gemini rejects any unknown key (`$schema`, `additionalProperties`, …) with a 400, so we
 * allowlist the fields it documents and transform the common JSON Schema constructs that have a
 * Gemini equivalent (`const`→`enum`, `$ref`→inline, type arrays→`nullable`, …). Everything else is
 * dropped rather than forwarded.
 *
 * Note: `responseJsonSchema` (structured output) accepts full JSON Schema, so it does NOT go
 * through here — only tool parameters do.
 */

// The fields Gemini's Schema object accepts (https://ai.google.dev/api/caching#Schema).
const GEMINI_SCHEMA_KEYS = new Set<string>([
	"type",
	"format",
	"title",
	"description",
	"nullable",
	"default",
	"example",
	"enum",
	"anyOf",
	"items",
	"minItems",
	"maxItems",
	"properties",
	"required",
	"propertyOrdering",
	"minProperties",
	"maxProperties",
	"minLength",
	"maxLength",
	"pattern",
	"minimum",
	"maximum",
]);

// `parametersJsonSchema` accepts the same useful vocabulary plus the JSON Schema fields that make
// strict object/tuple validation possible. The legacy `parameters` field still uses the narrower
// OpenAPI-shaped set above.
const GEMINI_JSON_SCHEMA_KEYS = new Set<string>([
	...GEMINI_SCHEMA_KEYS,
	"additionalProperties",
	"prefixItems",
]);

type GeminiSchemaDialect = "openapi" | "json_schema";

// Gemini only accepts a handful of `format` values, scoped by type; anything else is a 400.
const STRING_FORMATS = new Set(["enum", "date-time"]);
const JSON_SCHEMA_STRING_FORMATS = new Set([...STRING_FORMATS, "date", "time"]);
const NUMERIC_FORMATS = new Set(["int32", "int64", "float", "double"]);

function refName(ref: string): string | null {
	const m = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref);
	return m ? m[1]! : null;
}

function translate(
	node: unknown,
	defs: Record<string, unknown>,
	seen: ReadonlySet<string>,
	dialect: GeminiSchemaDialect,
): unknown {
	if (Array.isArray(node))
		return node.map((n) => translate(n, defs, seen, dialect));
	if (node === null || typeof node !== "object") return node;
	const src = node as Record<string, unknown>;

	// Bring any locally-declared definitions into scope so nested $refs resolve.
	let scope = defs;
	const localDefs = (src.$defs ?? src.definitions) as
		| Record<string, unknown>
		| undefined;
	if (localDefs !== null && typeof localDefs === "object") {
		scope = { ...defs, ...localDefs };
	}

	// Inline $ref. Cut self-referential cycles: Gemini can't express unbounded recursion, and
	// inlining one would never terminate.
	if (typeof src.$ref === "string") {
		const name = refName(src.$ref);
		if (name === null || seen.has(name) || !(name in scope)) {
			return { type: "object" };
		}
		return translate(scope[name], scope, new Set(seen).add(name), dialect);
	}

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(src)) {
		if (key === "const") {
			out.enum = [value];
			continue;
		}
		if (key === "examples" && Array.isArray(value)) {
			if (value.length > 0) out.example = value[0];
			continue;
		}
		// Gemini has no oneOf/allOf; anyOf is the closest expressible union.
		if (key === "oneOf" || key === "allOf") {
			out.anyOf = translate(value, scope, seen, dialect);
			continue;
		}
		const allowedKeys =
			dialect === "json_schema" ? GEMINI_JSON_SCHEMA_KEYS : GEMINI_SCHEMA_KEYS;
		if (!allowedKeys.has(key)) continue;
		if (dialect === "json_schema" && key === "nullable") continue;

		if (key === "type" && Array.isArray(value)) {
			if (dialect === "json_schema") out.type = structuredClone(value);
			else {
				// `["string", "null"]` → a single type plus `nullable`.
				const real = (value as unknown[]).filter((t) => t !== "null");
				if (value.includes("null")) out.nullable = true;
				out.type = real[0] ?? "object";
			}
		} else if (
			key === "properties" &&
			value !== null &&
			typeof value === "object"
		) {
			out.properties = Object.fromEntries(
				Object.entries(value as Record<string, unknown>).map(([p, s]) => [
					p,
					translate(s, scope, seen, dialect),
				]),
			);
		} else if (key === "items" || key === "anyOf" || key === "prefixItems") {
			out[key] = translate(value, scope, seen, dialect);
		} else if (key === "additionalProperties" && dialect === "json_schema") {
			out.additionalProperties =
				typeof value === "boolean"
					? value
					: translate(value, scope, seen, dialect);
		} else {
			out[key] = value;
		}
	}
	if (dialect === "json_schema" && src.nullable === true) {
		if (typeof out.type === "string") out.type = [out.type, "null"];
		else if (Array.isArray(out.type) && !out.type.includes("null"))
			out.type = [...out.type, "null"];
	}

	// Drop `format` values Gemini does not recognise for the resolved type (e.g. "uri", "uuid").
	if (typeof out.format === "string") {
		const t = out.type;
		const stringFormats =
			dialect === "json_schema" ? JSON_SCHEMA_STRING_FORMATS : STRING_FORMATS;
		const ok =
			(t === "string" && stringFormats.has(out.format)) ||
			((t === "integer" || t === "number") && NUMERIC_FORMATS.has(out.format));
		if (!ok) delete out.format;
	}

	return out;
}

export function toGeminiSchema(
	schema: Record<string, unknown>,
): Record<string, unknown> {
	const translated = translate(schema, {}, new Set<string>(), "openapi");
	const out =
		translated !== null &&
		typeof translated === "object" &&
		!Array.isArray(translated)
			? (translated as Record<string, unknown>)
			: {};
	// Tool parameters are an object; Gemini requires an explicit type at the root.
	if (out.type === undefined && out.anyOf === undefined) out.type = "object";
	return out;
}

/** JSON Schema form used only by Gemini 3+ strict function declarations. */
export function toGeminiJsonSchema(
	schema: Record<string, unknown>,
): Record<string, unknown> {
	const translated = translate(schema, {}, new Set<string>(), "json_schema");
	const out =
		translated !== null &&
		typeof translated === "object" &&
		!Array.isArray(translated)
			? (translated as Record<string, unknown>)
			: {};
	if (out.type === undefined && out.anyOf === undefined) out.type = "object";
	return out;
}
