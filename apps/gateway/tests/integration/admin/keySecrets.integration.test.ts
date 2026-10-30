import assert from "node:assert/strict";
import { test } from "node:test";

import "#adapters/index.ts";

import { pgAvailable, redisAvailable } from "#test-support/infra.ts";
import { getCachedVirtualKey } from "#auth/virtualKeyCache.ts";
import { makeGatewayTestApp } from "#test-support/app.ts";
import { adminAudit, virtualKeys } from "#db/schema.ts";
import { and, eq, like } from "drizzle-orm";
import { adminApp } from "#admin/index.ts";
import { env } from "#config/env.ts";
import { db } from "#db/client.ts";

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

interface IssuedKey {
	id: string;
	key: string;
	keyPrefix: string;
	private: boolean;
	copyable: boolean;
	spendCents: string;
	rpm: number | null;
}

async function issue(
	t: { after: (fn: () => Promise<void>) => void },
	body: Record<string, unknown> = {},
): Promise<IssuedKey> {
	const res = await app.request("/admin/keys", {
		method: "POST",
		headers: auth,
		body: JSON.stringify({
			name: `itest-secret-${crypto.randomUUID()}`,
			...body,
		}),
	});
	assert.equal(res.status, 201);
	const { data } = (await res.json()) as { data: IssuedKey };
	t.after(async () => {
		await app.request(`/admin/keys/${data.id}`, {
			method: "DELETE",
			headers: auth,
		});
		await db
			.delete(adminAudit)
			.where(like(adminAudit.action, `%/admin/keys/${data.id}%`));
	});
	return data;
}

function copy(id: string): Promise<Response> | Response {
	return app.request(`/admin/keys/${id}/secret`, { headers: auth });
}

test("key secrets: a key is copyable by default, and copying returns exactly the issued key", {
	skip,
}, async (t) => {
	const issued = await issue(t);
	assert.equal(issued.private, false);
	assert.equal(issued.copyable, true);

	const res = await copy(issued.id);
	assert.equal(res.status, 200);
	assert.equal(res.headers.get("cache-control"), "no-store");
	const { data } = (await res.json()) as { data: { key: string } };
	assert.equal(data.key, issued.key);

	// Listing and reading never carry the secret, sealed or otherwise.
	const read = await app.request(`/admin/keys/${issued.id}`, { headers: auth });
	const { data: row } = (await read.json()) as {
		data: Record<string, unknown>;
	};
	for (const field of ["key", "keyHash", "secret", "hasSecret"]) {
		assert.equal(field in row, false, field);
	}
	assert.equal(row.copyable, true);
});

test("key secrets: the envelope at rest is ciphertext, never the key", {
	skip,
}, async (t) => {
	const issued = await issue(t);
	const [stored] = await db
		.select({ secret: virtualKeys.secret })
		.from(virtualKeys)
		.where(eq(virtualKeys.id, issued.id));
	assert.ok(stored?.secret);
	assert.equal(stored.secret.purpose, "virtual-key-secret");
	assert.equal(JSON.stringify(stored).includes(issued.key), false);
});

test("key secrets: every copy is audited", { skip }, async (t) => {
	const issued = await issue(t);
	assert.equal((await copy(issued.id)).status, 200);
	// The audit write is fire-and-forget; give it the moment it takes.
	let rows: { status: number; targetId: string | null }[] = [];
	for (let attempt = 0; attempt < 20 && rows.length === 0; attempt++) {
		rows = await db
			.select({ status: adminAudit.status, targetId: adminAudit.targetId })
			.from(adminAudit)
			.where(
				and(
					eq(adminAudit.action, `GET /admin/keys/${issued.id}/secret`),
					eq(adminAudit.actor, "master-key"),
				),
			);
		if (rows.length === 0) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
	}
	assert.deepEqual(rows, [{ status: 200, targetId: issued.id }]);
});

test("key secrets: a private key is never stored and cannot be copied", {
	skip,
}, async (t) => {
	const issued = await issue(t, { private: true });
	assert.equal(issued.private, true);
	assert.equal(issued.copyable, false);
	assert.match(issued.key, /^sk-/);

	const [stored] = await db
		.select({ secret: virtualKeys.secret })
		.from(virtualKeys)
		.where(eq(virtualKeys.id, issued.id));
	assert.equal(stored?.secret, null);

	const res = await copy(issued.id);
	assert.equal(res.status, 409);
	const body = (await res.json()) as { error: { code?: string } };
	assert.equal(body.error.code, "virtual_key_private");
});

test("key secrets: unknown and malformed ids are a 404", {
	skip,
}, async (t) => {
	for (const id of [crypto.randomUUID(), "not-a-uuid"]) {
		t.after(async () => {
			await db
				.delete(adminAudit)
				.where(like(adminAudit.action, `%/admin/keys/${id}/%`));
		});
		assert.equal((await copy(id)).status, 404, id);
		const rotated = await app.request(`/admin/keys/${id}/rotate`, {
			method: "POST",
			headers: auth,
		});
		assert.equal(rotated.status, 404, id);
	}
});

test("key secrets: making a key private erases its secret, one way", {
	skip,
}, async (t) => {
	const issued = await issue(t);
	const made = await app.request(`/admin/keys/${issued.id}`, {
		method: "PATCH",
		headers: auth,
		body: JSON.stringify({ private: true }),
	});
	assert.equal(made.status, 200);
	const { data } = (await made.json()) as { data: IssuedKey };
	assert.equal(data.private, true);
	assert.equal(data.copyable, false);
	assert.equal((await copy(issued.id)).status, 409);

	// The key itself keeps working: only the stored copy is gone.
	assert.ok(await getCachedVirtualKey(issued.key));

	const back = await app.request(`/admin/keys/${issued.id}`, {
		method: "PATCH",
		headers: auth,
		body: JSON.stringify({ private: false }),
	});
	assert.equal(back.status, 400);
});

test("key secrets: rotating replaces the secret, keeps the key, and retires the old one at once", {
	skip,
}, async (t) => {
	const issued = await issue(t, { rpm: 42 });
	// Warm the auth cache, so the test proves the old entry is evicted rather than merely expired.
	assert.ok(await getCachedVirtualKey(issued.key));

	const res = await app.request(`/admin/keys/${issued.id}/rotate`, {
		method: "POST",
		headers: auth,
	});
	assert.equal(res.status, 200);
	const { data: rotated } = (await res.json()) as { data: IssuedKey };
	assert.equal(rotated.id, issued.id);
	assert.equal(rotated.rpm, 42);
	assert.notEqual(rotated.key, issued.key);
	assert.equal(rotated.keyPrefix, rotated.key.slice(0, 10));
	assert.equal(rotated.private, false, "a bare rotation keeps the setting");

	assert.equal(await getCachedVirtualKey(issued.key), null);
	assert.equal((await getCachedVirtualKey(rotated.key))?.id, issued.id);

	const copied = await copy(issued.id);
	const { data } = (await copied.json()) as { data: { key: string } };
	assert.equal(data.key, rotated.key);
});

test("key secrets: rotation keeps a private key private unless asked otherwise", {
	skip,
}, async (t) => {
	const issued = await issue(t, { private: true });

	const kept = await app.request(`/admin/keys/${issued.id}/rotate`, {
		method: "POST",
		headers: auth,
		body: JSON.stringify({}),
	});
	const { data: still } = (await kept.json()) as { data: IssuedKey };
	assert.equal(still.private, true);
	assert.equal((await copy(issued.id)).status, 409);

	const opened = await app.request(`/admin/keys/${issued.id}/rotate`, {
		method: "POST",
		headers: auth,
		body: JSON.stringify({ private: false }),
	});
	const { data: copyable } = (await opened.json()) as { data: IssuedKey };
	assert.equal(copyable.private, false);
	assert.equal(copyable.copyable, true);
	const copied = await copy(issued.id);
	const { data } = (await copied.json()) as { data: { key: string } };
	assert.equal(data.key, copyable.key);
});

test("key secrets: a secret that no longer matches its key is never handed out", {
	skip,
}, async (t) => {
	const first = await issue(t);
	const second = await issue(t);
	// Move one key's envelope onto the other row: authenticated encryption alone would accept it.
	const [moved] = await db
		.select({ secret: virtualKeys.secret })
		.from(virtualKeys)
		.where(eq(virtualKeys.id, first.id));
	await db
		.update(virtualKeys)
		.set({ secret: moved?.secret ?? null })
		.where(eq(virtualKeys.id, second.id));

	const res = await copy(second.id);
	assert.equal(res.status, 409);
	const body = (await res.json()) as { error: { code?: string } };
	assert.equal(body.error.code, "virtual_key_secret_unreadable");
});
