/**
 * Integration (real Postgres + Redis) for VIRTUAL_KEY_SECRET_ACCESS=sealed.
 *
 * The policy is read from the environment, which is validated once per process, so this file sets it
 * before anything that imports the config and reaches the modules through dynamic imports — the
 * same shape as the guarantee: sealing is a deployment decision, not a runtime toggle.
 */

process.env.VIRTUAL_KEY_SECRET_ACCESS = "sealed";

import assert from "node:assert/strict";
import { test } from "node:test";

await import("#adapters/index.ts");
const { pgAvailable, redisAvailable } = await import("#test-support/infra.ts");
const { makeGatewayTestApp } = await import("#test-support/app.ts");
const { adminAudit, virtualKeys } = await import("#db/schema.ts");
const { adminApp } = await import("#admin/index.ts");
const { eq, like } = await import("drizzle-orm");
const { env } = await import("#config/env.ts");
const { db } = await import("#db/client.ts");

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

test("sealed key secrets: stored, never copyable, and refused with a reason", {
	skip,
}, async (t) => {
	const created = await app.request("/admin/keys", {
		method: "POST",
		headers: auth,
		body: JSON.stringify({ name: `itest-sealed-${crypto.randomUUID()}` }),
	});
	assert.equal(created.status, 201);
	const { data: issued } = (await created.json()) as {
		data: { id: string; private: boolean; copyable: boolean };
	};
	t.after(async () => {
		await app.request(`/admin/keys/${issued.id}`, {
			method: "DELETE",
			headers: auth,
		});
		await db
			.delete(adminAudit)
			.where(like(adminAudit.action, `%/admin/keys/${issued.id}%`));
	});

	// Sealing is an access policy: the secret is kept for the day access opens again.
	assert.equal(issued.private, false);
	assert.equal(issued.copyable, false);
	const [stored] = await db
		.select({ secret: virtualKeys.secret })
		.from(virtualKeys)
		.where(eq(virtualKeys.id, issued.id));
	assert.ok(stored?.secret);

	const res = await app.request(`/admin/keys/${issued.id}/secret`, {
		headers: auth,
	});
	assert.equal(res.status, 403);
	const body = (await res.json()) as { error: { code?: string } };
	assert.equal(body.error.code, "virtual_key_secret_sealed");
});
