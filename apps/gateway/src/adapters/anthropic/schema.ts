/**
 * Fit a JSON Schema to the subset Anthropic compiles for constrained decoding — tools with
 * `strict: true` and `output_config.format`. Outside that subset the request is a 400 (e.g.
 * `For 'array' type, property 'maxItems' is not supported`), while OpenAI's strict mode accepts
 * those keywords, so OpenAI-shaped clients send them.
 *
 * Keywords Anthropic documents as supported are kept as they are. Every other constraint moves into
 * the node's `description` as `{maxItems: 5}`, the same hint Anthropic's SDKs emit, so the model
 * still sees it while the caller keeps validating against its original schema.
 *
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations
 */

const KEPT_KEYS = new Set<string>([
	"type",
	"title",
	"description",
	"default",
	"const",
	"required",
	"pattern",
	"$ref",
]);

// Schema metadata that tells the model nothing; dropped rather than described.
const DROPPED_KEYS = new Set<string>(["$schema", "$id", "$comment"]);

const SUPPORTED_STRING_FORMATS = new Set<string>([
	"date-time",
	"time",
	"date",
	"duration",
	"email",
	"hostname",
	"uri",
	"ipv4",
	"ipv6",
	"uuid",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Enums may only list strings, numbers, booleans and nulls.
function isScalar(value: unknown): boolean {
	return value === null || typeof value !== "object";
}

function isObjectType(type: unknown): boolean {
	return type === "object" || (Array.isArray(type) && type.includes("object"));
}

function sanitizeMap(map: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(map).map(([name, schema]) => [name, sanitize(schema)]),
	);
}

function sanitize(node: unknown): unknown {
	if (!isRecord(node)) {
		return node;
	}
	const out: Record<string, unknown> = {};
	const unsupported: [string, unknown][] = [];
	for (const [key, value] of Object.entries(node)) {
		if (DROPPED_KEYS.has(key)) {
			continue;
		}
		if (KEPT_KEYS.has(key)) {
			out[key] = value;
			continue;
		}
		switch (key) {
			case "properties":
			case "$defs":
			case "definitions":
				if (isRecord(value)) {
					out[key] = sanitizeMap(value);
				} else {
					unsupported.push([key, value]);
				}
				break;
			case "items":
				// The draft-07 tuple form (`items: [...]`) has no strict equivalent.
				if (isRecord(value)) {
					out.items = sanitize(value);
				} else {
					unsupported.push([key, value]);
				}
				break;
			case "anyOf":
			case "allOf":
				if (Array.isArray(value)) {
					out[key] = value.map(sanitize);
				} else {
					unsupported.push([key, value]);
				}
				break;
			case "oneOf":
				// No `oneOf` in strict mode; `anyOf` is the closest union, as in Anthropic's SDKs.
				if (Array.isArray(value) && node.anyOf === undefined) {
					out.anyOf = value.map(sanitize);
				} else {
					unsupported.push([key, value]);
				}
				break;
			case "additionalProperties":
				// Strict objects must be closed; a map or `true` cannot be compiled.
				out.additionalProperties = false;
				break;
			case "enum":
				if (Array.isArray(value) && value.every(isScalar)) {
					out.enum = value;
				} else {
					unsupported.push([key, value]);
				}
				break;
			case "format":
				if (typeof value === "string" && SUPPORTED_STRING_FORMATS.has(value)) {
					out.format = value;
				} else {
					unsupported.push([key, value]);
				}
				break;
			case "minItems":
				if (value === 0 || value === 1) {
					out.minItems = value;
					break;
				}
				// A larger minimum still implies a non-empty array, which strict mode can enforce.
				if (typeof value === "number" && value > 1) {
					out.minItems = 1;
				}
				unsupported.push([key, value]);
				break;
			default:
				unsupported.push([key, value]);
		}
	}
	if (out.additionalProperties === undefined && isObjectType(node.type)) {
		out.additionalProperties = false;
	}
	if (unsupported.length > 0) {
		const hint = `{${unsupported
			.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
			.join(", ")}}`;
		out.description =
			typeof out.description === "string" && out.description !== ""
				? `${out.description}\n\n${hint}`
				: hint;
	}
	return out;
}

export function toAnthropicStrictSchema(
	schema: Record<string, unknown>,
): Record<string, unknown> {
	return sanitize(schema) as Record<string, unknown>;
}
