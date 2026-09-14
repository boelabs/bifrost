/**
 * Integration (real Postgres) for OBSERVABILITY_PAYLOAD_ACCESS=sealed.
 *
 * The policy is read from the environment, which is validated once per process, so this file sets it
 * before anything that imports the config and reaches the modules through dynamic imports. That is
 * also the shape of the guarantee under test: sealing is a deployment decision, not a runtime toggle
 * something inside the process can flip.
 */

process.env.OBSERVABILITY_PAYLOAD_ACCESS = "sealed";

import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

const { payloadAccessAudit, payloadSamples } = await import("#db/schema.ts");
const { getPayloadSample, payloadAccessIsOpen } = await import(
	"#logging/operations.ts"
);
const { pgAvailable } = await import("#test-support/infra.ts");
const { encryptJson } = await import("#db/crypto.ts");
const { db } = await import("#db/client.ts");
const { eq } = await import("drizzle-orm");

const skip = (await pgAvailable()) ? false : "Postgres unavailable";

test("sealed access: a live sample is refused, audited, and never decrypted", {
	skip,
}, async () => {
	assert.equal(payloadAccessIsOpen(), false);
	const operationId = randomUUID();
	await db.insert(payloadSamples).values({
		operationId,
		captureReason: "success",
		envelope: encryptJson(
			{ request: { secret: "x" } },
			"observability-payload",
		),
		expiresAt: new Date(Date.now() + 60_000),
	});
	try {
		const read = await getPayloadSample(operationId, {
			requestId: "itest",
			actor: "master-key",
		});
		assert.equal(read.outcome, "sealed");
		assert.equal(
			"payload" in read,
			false,
			"a sealed read must not carry plaintext",
		);

		const audit = await db
			.select({ outcome: payloadAccessAudit.outcome })
			.from(payloadAccessAudit)
			.where(eq(payloadAccessAudit.operationId, operationId));
		assert.deepEqual(
			audit.map((row) => row.outcome),
			["sealed"],
			"a refused read is still a read attempt, and belongs in the trail",
		);

		// Capture is untouched by the policy: the sample is still there for the day the deployment
		// opens access again.
		const [sample] = await db
			.select({ accessedAt: payloadSamples.accessedAt })
			.from(payloadSamples)
			.where(eq(payloadSamples.operationId, operationId));
		assert.ok(sample, "sealing must not delete or skip the sample");
		assert.equal(
			sample.accessedAt,
			null,
			"nothing read it, so nothing timestamps it",
		);
	} finally {
		await db
			.delete(payloadSamples)
			.where(eq(payloadSamples.operationId, operationId));
		await db
			.delete(payloadAccessAudit)
			.where(eq(payloadAccessAudit.operationId, operationId));
	}
});
