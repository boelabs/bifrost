import assert from "node:assert/strict";
import { test } from "node:test";

import "#adapters/index.ts";

import { pgAvailable, redisAvailable } from "#test-support/infra.ts";
import { makeGatewayTestApp } from "#test-support/app.ts";
import { adminApp } from "#admin/index.ts";
import { env } from "#config/env.ts";

const skip =
	(await pgAvailable()) && (await redisAvailable())
		? false
		: "Postgres or Redis unavailable";

const app = makeGatewayTestApp((a) => {
	a.route("/admin", adminApp);
});

const auth = {
	authorization: `Bearer ${env.MASTER_KEY}`,
	"content-type": "application/json",
};

test("keys: one key reads back as it was issued, never with its secret", {
	skip,
}, async (t) => {
	const created = await app.request("/admin/keys", {
		method: "POST",
		headers: auth,
		body: JSON.stringify({
			name: `itest-get-${crypto.randomUUID()}`,
			allowedModels: ["gpt"],
			rpm: 60,
		}),
	});
	assert.equal(created.status, 201);
	const { data: issued } = (await created.json()) as {
		data: Record<string, unknown> & { id: string; key: string };
	};
	t.after(async () => {
		await app.request(`/admin/keys/${issued.id}`, {
			method: "DELETE",
			headers: auth,
		});
	});

	const res = await app.request(`/admin/keys/${issued.id}`, { headers: auth });
	assert.equal(res.status, 200);
	const { data } = (await res.json()) as { data: Record<string, unknown> };
	assert.equal("key" in data, false);
	assert.equal("keyHash" in data, false);
	const { key: _secret, ...stored } = issued;
	assert.deepEqual(data, stored);
	assert.deepEqual(data.allowedModels, ["gpt"]);
	assert.equal(data.rpm, 60);
});

test("keys: an id that names no key is a 404, malformed or not", {
	skip,
}, async () => {
	for (const id of [crypto.randomUUID(), "not-a-uuid"]) {
		const res = await app.request(`/admin/keys/${id}`, { headers: auth });
		assert.equal(res.status, 404, id);
		const body = (await res.json()) as { error: { type?: string } };
		assert.ok(body.error, id);
	}
});
