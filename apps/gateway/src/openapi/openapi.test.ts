import { CreateDeployment, UpdateDeployment } from "./components.ts";
import { buildOpenApiDocument } from "./document.ts";
import assert from "node:assert/strict";
import { parse, stringify } from "yaml";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
	createDeploymentSchema,
	updateDeploymentSchema,
} from "#admin/platform.ts";

const committed = readFileSync(
	new URL("../../openapi.yaml", import.meta.url),
	"utf8",
);
const doc = buildOpenApiDocument() as {
	openapi: string;
	paths: Record<string, unknown>;
	components: { schemas: Record<string, unknown> };
};

test("openapi: committed openapi.yaml is up to date with the generator", () => {
	// Mirror scripts/openapi-generate.ts exactly so a stale committed file fails CI.
	const banner =
		"# GENERATED FILE - do not edit by hand.\n" +
		"# Source: src/openapi/*.ts. Regenerate with `bun run openapi:generate`.\n";
	const regenerated = banner + stringify(doc, { lineWidth: 0 });
	assert.equal(
		committed,
		regenerated,
		"openapi.yaml is stale — run `bun run openapi:generate`",
	);
});

test("openapi: document is a structurally valid 3.1 spec with resolving refs", () => {
	assert.equal(doc.openapi, "3.1.0");
	assert.equal(Object.keys(doc.paths).length, 53);

	// Every local $ref must resolve to a defined component.
	const text = JSON.stringify(doc);
	const refs = [...text.matchAll(/"#\/components\/([^"]+)"/g)].map(
		(m) => m[1]!,
	);
	const flat = JSON.parse(text) as Record<string, unknown>;
	for (const ref of new Set(refs)) {
		let node: unknown = (flat as { components: unknown }).components;
		for (const key of ref.split("/")) {
			node = (node as Record<string, unknown>)?.[key];
		}
		assert.ok(node !== undefined, `unresolved $ref: #/components/${ref}`);
	}
});

test("openapi: CreateDeployment/UpdateDeployment stay in sync with the runtime schemas", () => {
	// The doc schema must document exactly the fields the admin API validates — this is the guard
	// that catches "added a field to the Zod validator but forgot the spec" drift.
	const runtimeKeys = (schema: { shape: Record<string, unknown> }) =>
		Object.keys(schema.shape).sort();
	const docKeys = (schema: { shape: Record<string, unknown> }) =>
		Object.keys(schema.shape).sort();

	assert.deepEqual(
		docKeys(CreateDeployment as never),
		runtimeKeys(createDeploymentSchema as never),
		"CreateDeployment doc schema drifted from createDeploymentSchema",
	);
	assert.deepEqual(
		docKeys(UpdateDeployment as never),
		runtimeKeys(updateDeploymentSchema as never),
		"UpdateDeployment doc schema drifted from updateDeploymentSchema",
	);
});

test("openapi: committed file parses as YAML", () => {
	const parsed = parse(committed) as { openapi?: string };
	assert.equal(parsed.openapi, "3.1.0");
});

test("openapi: every management 2xx response carries a schema", () => {
	// A response documented only in prose makes a generated client type it `unknown`, which defeats
	// the point of publishing a spec. 204 is the one legitimate exception: it has no body.
	const paths = doc.paths as Record<
		string,
		Record<string, { responses?: Record<string, { content?: unknown }> }>
	>;
	const bare: string[] = [];
	for (const [path, operations] of Object.entries(paths)) {
		if (!/^\/(admin|auth)\b/.test(path)) {
			continue;
		}
		for (const [method, operation] of Object.entries(operations)) {
			for (const [code, response] of Object.entries(
				operation?.responses ?? {},
			)) {
				if (!code.startsWith("2") || code === "204") {
					continue;
				}
				if (!response?.content) {
					bare.push(`${method.toUpperCase()} ${path} -> ${code}`);
				}
			}
		}
	}
	assert.deepEqual(
		bare,
		[],
		`management responses without a schema:\n${bare.join("\n")}`,
	);
});
