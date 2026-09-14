/**
 * Integration (real Postgres) for reading a retained payload sample with access OPEN, which is the
 * default: what each outcome returns, and that every one of them — including the empty ones — leaves
 * an audit row behind. The sealed half lives in its own file, because the policy is read from the
 * environment once per process.
 */

import { getPayloadSample, payloadAccessIsOpen } from "#logging/operations.ts";
import { payloadAccessAudit, payloadSamples } from "#db/schema.ts";
import { pgAvailable } from "#test-support/infra.ts";
import { encryptJson } from "#db/crypto.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { db } from "#db/client.ts";
import { eq } from "drizzle-orm";
import { test } from "node:test";

const skip = (await pgAvailable()) ? false : "Postgres unavailable";

async function seed(operationId: string, expiresAt: Date) {
	await db.insert(payloadSamples).values({
		operationId,
		captureReason: "success",
		envelope: encryptJson({ request: { model: "m" } }, "observability-payload"),
		expiresAt,
	});
}

async function auditOutcomes(operationId: string): Promise<string[]> {
	const rows = await db
		.select({ outcome: payloadAccessAudit.outcome })
		.from(payloadAccessAudit)
		.where(eq(payloadAccessAudit.operationId, operationId));
	return rows.map((row) => row.outcome);
}

async function cleanup(operationId: string) {
	await db
		.delete(payloadSamples)
		.where(eq(payloadSamples.operationId, operationId));
	await db
		.delete(payloadAccessAudit)
		.where(eq(payloadAccessAudit.operationId, operationId));
}

test("payload samples: a live sample is revealed, timestamped and audited", {
	skip,
}, async () => {
	assert.equal(payloadAccessIsOpen(), true, "default access must be open");
	const operationId = randomUUID();
	await seed(operationId, new Date(Date.now() + 60_000));
	try {
		const read = await getPayloadSample(operationId, {
			requestId: "itest",
			actor: "user:itest",
		});
		assert.equal(read.outcome, "revealed");
		assert.deepEqual(
			read.outcome === "revealed" ? read.payload : null,
			{ request: { model: "m" } },
			"the envelope must decrypt to what was sealed",
		);
		assert.deepEqual(await auditOutcomes(operationId), ["revealed"]);
		const [row] = await db
			.select({ accessedAt: payloadSamples.accessedAt })
			.from(payloadSamples)
			.where(eq(payloadSamples.operationId, operationId));
		assert.ok(row?.accessedAt, "a revealed sample records when it was read");
	} finally {
		await cleanup(operationId);
	}
});

test("payload samples: an expired sample reads as missing, and still audits", {
	skip,
}, async () => {
	const operationId = randomUUID();
	// Retention sweeps on an interval, so an expired row can outlive its own window: reading one must
	// behave as if it were already gone rather than hand back content past its retention.
	await seed(operationId, new Date(Date.now() - 1_000));
	try {
		const read = await getPayloadSample(operationId, {
			requestId: "itest",
			actor: "user:itest",
		});
		assert.equal(read.outcome, "missing");
		assert.deepEqual(await auditOutcomes(operationId), ["missing"]);
	} finally {
		await cleanup(operationId);
	}
});

test("payload samples: an unknown operation audits the attempt", {
	skip,
}, async () => {
	const operationId = randomUUID();
	try {
		const read = await getPayloadSample(operationId, {
			requestId: "itest",
			actor: "master-key",
		});
		assert.equal(read.outcome, "missing");
		assert.deepEqual(await auditOutcomes(operationId), ["missing"]);
	} finally {
		await cleanup(operationId);
	}
});

test("payload samples: a sample sealed by a retired key is unreadable, not a crash", {
	skip,
}, async () => {
	const operationId = randomUUID();
	const envelope = encryptJson({ request: {} }, "observability-payload");
	await db.insert(payloadSamples).values({
		operationId,
		captureReason: "error",
		envelope: { ...envelope, kid: "retired-key-that-is-not-in-the-keyring" },
		expiresAt: new Date(Date.now() + 60_000),
	});
	try {
		const read = await getPayloadSample(operationId, {
			requestId: "itest",
			actor: "root",
		});
		assert.equal(read.outcome, "unreadable");
		assert.deepEqual(await auditOutcomes(operationId), ["unreadable"]);
	} finally {
		await cleanup(operationId);
	}
});
