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

test("keys: the list search finds a key by part of its name or by its prefix", {
	skip,
}, async (t) => {
	const tag = crypto.randomUUID();
	const created = await app.request("/admin/keys", {
		method: "POST",
		headers: auth,
		body: JSON.stringify({ name: `itest-search-${tag}` }),
	});
	assert.equal(created.status, 201);
	const { data: issued } = (await created.json()) as {
		data: { id: string; keyPrefix: string };
	};
	t.after(async () => {
		await app.request(`/admin/keys/${issued.id}`, {
			method: "DELETE",
			headers: auth,
		});
	});

	for (const q of [tag.slice(0, 13), issued.keyPrefix]) {
		const res = await app.request(
			`/admin/keys?q=${encodeURIComponent(q)}&limit=200`,
			{ headers: auth },
		);
		assert.equal(res.status, 200, q);
		const page = (await res.json()) as { data: { id: string }[] };
		assert.ok(
			page.data.some((row) => row.id === issued.id),
			`no key found for "${q}"`,
		);
	}
});
