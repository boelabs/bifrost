import assert from "node:assert/strict";
import { test } from "node:test";

import "#adapters/index.ts";

import { makeGatewayTestApp } from "#test-support/app.ts";
import { pgAvailable } from "#test-support/infra.ts";
import { adminApp } from "#admin/index.ts";
import { env } from "#config/env.ts";

const skip = (await pgAvailable()) ? false : "Postgres unavailable";

// Mount the real admin app behind the gateway's error handler so GatewayError maps to HTTP status.
const app = makeGatewayTestApp((a) => a.route("/admin", adminApp));

const auth = { authorization: `Bearer ${env.MASTER_KEY}` };
const json = { ...auth, "content-type": "application/json" };

// Unique, pattern-valid key (^[a-z0-9]+$) so the suite does not collide with real data.
const KEY = `itest${Date.now()}`;
const INSTANCE_ID = `itest-instance-${Date.now()}`;

function moduleCode(suffix: string): string {
	return `
		import { defineExtension } from "#extensions/sdk.ts";
		export default defineExtension({
			key: "${KEY}",
			hooks: {
				onCanonicalResponse(ctx, response) {
					return { ...response, _marker: "${suffix}" };
				}
			}
		});
	`;
}

interface StatusBody {
	data: {
		definitions: Array<{ key: string }>;
		instances: Array<{ id: string; status: string; definition: string }>;
	};
}

async function status(): Promise<StatusBody["data"]> {
	const res = await app.request("/admin/extensions", { headers: auth });
	assert.equal(res.status, 200);
	return ((await res.json()) as StatusBody).data;
}

test("admin extensions: upload, instance, hot-reload, versioning, and cleanup", {
	skip,
}, async (t) => {
	t.after(async () => {
		await app.request(`/admin/extensions/instances/${INSTANCE_ID}`, {
			method: "DELETE",
			headers: auth,
		});
		await app.request(`/admin/extensions/artifacts/${KEY}`, {
			method: "DELETE",
			headers: auth,
		});
	});

	// Upload v1 -> becomes active and loads into the running process.
	const up1 = await app.request("/admin/extensions/artifacts", {
		method: "POST",
		headers: json,
		body: JSON.stringify({ key: KEY, code: moduleCode("v1") }),
	});
	assert.equal(up1.status, 201, await up1.clone().text());
	const v1 = (await up1.json()) as { data: { version: number } };
	assert.equal(v1.data.version, 1);

	// Configure an instance bound to the definition.
	const inst = await app.request("/admin/extensions/instances", {
		method: "POST",
		headers: json,
		body: JSON.stringify({
			id: INSTANCE_ID,
			definition: KEY,
			match: { callTypes: ["chat"] },
		}),
	});
	assert.equal(inst.status, 201);

	// The running process reloaded: definition is loaded and the instance is active.
	const loaded = await status();
	assert.ok(loaded.definitions.some((d) => d.key === KEY));
	const active = loaded.instances.find((i) => i.id === INSTANCE_ID);
	assert.ok(active);
	assert.equal(active!.status, "active");
	assert.equal(active!.definition, KEY);

	// Upload v2 -> version increments, previous one is archived.
	const up2 = await app.request("/admin/extensions/artifacts", {
		method: "POST",
		headers: json,
		body: JSON.stringify({ key: KEY, code: moduleCode("v2") }),
	});
	assert.equal(up2.status, 201);
	assert.equal(
		((await up2.json()) as { data: { version: number } }).data.version,
		2,
	);

	const versionsRes = await app.request(
		`/admin/extensions/artifacts/${KEY}/versions`,
		{ headers: auth },
	);
	const versions = (
		(await versionsRes.json()) as {
			data: Array<{ version: number; status: string }>;
		}
	).data;
	assert.equal(versions.length, 2);
	assert.equal(versions.find((v) => v.version === 2)!.status, "active");
	assert.equal(versions.find((v) => v.version === 1)!.status, "archived");

	// Rollback to v1.
	const rollback = await app.request(
		`/admin/extensions/artifacts/${KEY}/activate`,
		{ method: "POST", headers: json, body: JSON.stringify({ version: 1 }) },
	);
	assert.equal(rollback.status, 200);
	const afterRollback = (
		(await rollback.json()) as {
			data: Array<{ version: number; status: string }>;
		}
	).data;
	assert.equal(afterRollback.find((v) => v.version === 1)!.status, "active");

	// Activating a missing version is a 404.
	const missing = await app.request(
		`/admin/extensions/artifacts/${KEY}/activate`,
		{ method: "POST", headers: json, body: JSON.stringify({ version: 99 }) },
	);
	assert.equal(missing.status, 404);
});

test("admin extensions: an invalid module is rejected at upload", {
	skip,
}, async () => {
	const res = await app.request("/admin/extensions/artifacts", {
		method: "POST",
		headers: json,
		// Exports a definition whose key does not match the uploaded key.
		body: JSON.stringify({
			key: `${KEY}bad`,
			code: `export default { key: "somethingelse", hooks: {} };`,
		}),
	});
	assert.equal(res.status, 400);
});
