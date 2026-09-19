import assert from "node:assert/strict";
import { test } from "node:test";

import "#adapters/index.ts";

import { pgAvailable, redisAvailable } from "#test-support/infra.ts";
import { releaseIdempotencyKey } from "#db/repos/idempotency.ts";
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

async function createKey(
	name: string,
	idempotencyKey?: string,
): Promise<Response> {
	return app.request("/admin/keys", {
		method: "POST",
		headers: idempotencyKey
			? { ...auth, "Idempotency-Key": idempotencyKey }
			: auth,
		body: JSON.stringify({ name }),
	});
}

test("idempotency: a repeated create replays instead of creating twice", {
	skip,
}, async (t) => {
	const idempotencyKey = `itest-${crypto.randomUUID()}`;
	const name = `itest-idem-${crypto.randomUUID()}`;
	const createdIds: string[] = [];

	t.after(async () => {
		for (const id of createdIds) {
			await app.request(`/admin/keys/${id}`, {
				method: "DELETE",
				headers: auth,
			});
		}
		await releaseIdempotencyKey("master-key", idempotencyKey);
	});

	const first = await createKey(name, idempotencyKey);
	assert.equal(first.status, 201);
	const firstBody = (await first.json()) as {
		data: { id: string; key: string };
	};
	createdIds.push(firstBody.data.id);
	assert.equal(first.headers.get("idempotent-replay"), "false");

	/* ---- the retry returns the first response, down to the plaintext key ---- */

	const replay = await createKey(name, idempotencyKey);
	assert.equal(replay.status, 201);
	assert.equal(replay.headers.get("idempotent-replay"), "true");
	const replayBody = (await replay.json()) as {
		data: { id: string; key: string };
	};
	assert.equal(replayBody.data.id, firstBody.data.id);
	assert.equal(replayBody.data.key, firstBody.data.key);

	/* ---- the same key with a different body is a client bug, not a replay ---- */

	const conflicting = await createKey(`${name}-other`, idempotencyKey);
	assert.equal(conflicting.status, 409);
	const conflictBody = (await conflicting.json()) as {
		error: { code: string | null };
	};
	assert.equal(conflictBody.error.code, "idempotency_key_reuse");

	/* ---- without the header nothing is deduplicated ---- */

	const second = await createKey(name);
	assert.equal(second.status, 201);
	const secondBody = (await second.json()) as { data: { id: string } };
	createdIds.push(secondBody.data.id);
	assert.notEqual(secondBody.data.id, firstBody.data.id);
});

test("audit: the trail records the create and can be filtered", {
	skip,
}, async (t) => {
	const name = `itest-audit-${crypto.randomUUID()}`;
	let createdId: string | undefined;
	t.after(async () => {
		if (createdId) {
			await app.request(`/admin/keys/${createdId}`, {
				method: "DELETE",
				headers: auth,
			});
		}
	});

	const created = await createKey(name);
	assert.equal(created.status, 201);
	createdId = ((await created.json()) as { data: { id: string } }).data.id;

	const trail = await app.request("/admin/audit?limit=50&action=/admin/keys", {
		headers: auth,
	});
	assert.equal(trail.status, 200);
	const body = (await trail.json()) as {
		data: {
			kind: string;
			actor: string;
			action: string;
			status: number | null;
			targetType: string | null;
		}[];
		pagination: { total: number };
	};
	const entry = body.data.find(
		(row) => row.action === "POST /admin/keys" && row.status === 201,
	);
	assert.ok(entry, "expected the create to be audited");
	assert.equal(entry.kind, "admin");
	assert.equal(entry.targetType, "keys");
	assert.ok(body.pagination.total >= 1);

	/* ---- paging past the merge depth is refused, not answered slowly ---- */

	const tooDeep = await app.request("/admin/audit?limit=50&offset=100000", {
		headers: auth,
	});
	assert.equal(tooDeep.status, 400);
	assert.equal(
		((await tooDeep.json()) as { error: { code: string | null } }).error.code,
		"audit_offset_too_deep",
	);

	/* ---- reads are deliberately not audited ---- */

	const listed = await app.request("/admin/keys?limit=1", { headers: auth });
	assert.equal(listed.status, 200);
	const afterRead = await app.request("/admin/audit?limit=50&action=GET", {
		headers: auth,
	});
	const reads = (await afterRead.json()) as { data: { action: string }[] };
	assert.equal(
		reads.data.some((row) => row.action.startsWith("GET /admin/keys")),
		false,
	);
});
