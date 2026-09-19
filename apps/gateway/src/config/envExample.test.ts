import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * `.env.example` is the only place most operators ever read about a setting, so it going stale is
 * the same as the setting being undocumented. This holds it to the schema in both directions: a new
 * variable has to be explained, and a removed one cannot linger as advice.
 */
const here = new URL(".", import.meta.url);
const names = (text: string, pattern: RegExp) =>
	new Set([...text.matchAll(pattern)].map((match) => match[1] as string));

/** Read by the OpenTelemetry SDK directly rather than through our schema. */
const EXTERNAL = new Set(["OTEL_EXPORTER_OTLP_ENDPOINT"]);

test(".env.example lists exactly the variables the schema declares", () => {
	const schema = names(
		readFileSync(new URL("env.ts", here), "utf8"),
		/^\s+([A-Z][A-Z0-9_]{2,}):/gm,
	);
	const example = names(
		readFileSync(new URL("../../.env.example", here), "utf8"),
		/^([A-Z][A-Z0-9_]{2,})=/gm,
	);

	const undocumented = [...schema].filter((name) => !example.has(name)).sort();
	assert.deepEqual(
		undocumented,
		[],
		`declared in env.ts but missing from .env.example: ${undocumented.join(", ")}`,
	);

	const stale = [...example]
		.filter((name) => !(schema.has(name) || EXTERNAL.has(name)))
		.sort();
	assert.deepEqual(
		stale,
		[],
		`in .env.example but no longer read: ${stale.join(", ")}`,
	);
});
