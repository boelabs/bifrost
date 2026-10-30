import { IDEMPOTENCY_PURPOSE } from "#db/repos/idempotency.ts";
import { closeDb, db } from "#db/client.ts";
import { and, eq, sql } from "drizzle-orm";

import {
	activeEncryptionKeyId,
	type EncEnvelope,
	decryptRecord,
	decryptString,
	decryptJson,
	encryptJson,
} from "#db/crypto.ts";

import {
	extensionArtifacts,
	modelDeployments,
	idempotencyKeys,
	payloadSamples,
} from "#db/schema.ts";

const BATCH_SIZE = 100;

async function rotateDeployments(): Promise<number> {
	let rotated = 0;
	while (true) {
		const rows = await db
			.select({
				id: modelDeployments.id,
				envelope: modelDeployments.credentials,
			})
			.from(modelDeployments)
			.where(
				sql`${modelDeployments.credentials}->>'kid' IS DISTINCT FROM ${activeEncryptionKeyId()}`,
			)
			.limit(BATCH_SIZE);
		if (rows.length === 0) {
			return rotated;
		}
		const batchRotated = await db.transaction(async (tx) => {
			let updatedCount = 0;
			for (const row of rows) {
				const value = decryptRecord(row.envelope, "deployment-credentials");
				const updated = await tx
					.update(modelDeployments)
					.set({ credentials: encryptJson(value, "deployment-credentials") })
					.where(
						and(
							eq(modelDeployments.id, row.id),
							eq(modelDeployments.credentials, row.envelope),
						),
					)
					.returning({ id: modelDeployments.id });
				updatedCount += updated.length;
			}
			return updatedCount;
		});
		rotated += batchRotated;
	}
}

async function rotateExtensions(): Promise<number> {
	let rotated = 0;
	while (true) {
		const rows = await db
			.select({ id: extensionArtifacts.id, envelope: extensionArtifacts.code })
			.from(extensionArtifacts)
			.where(
				sql`${extensionArtifacts.code}->>'kid' IS DISTINCT FROM ${activeEncryptionKeyId()}`,
			)
			.limit(BATCH_SIZE);
		if (rows.length === 0) {
			return rotated;
		}
		const batchRotated = await db.transaction(async (tx) => {
			let updatedCount = 0;
			for (const row of rows) {
				const value = decryptString(row.envelope, "extension-source");
				const updated = await tx
					.update(extensionArtifacts)
					.set({ code: encryptJson(value, "extension-source") })
					.where(
						and(
							eq(extensionArtifacts.id, row.id),
							eq(extensionArtifacts.code, row.envelope),
						),
					)
					.returning({ id: extensionArtifacts.id });
				updatedCount += updated.length;
			}
			return updatedCount;
		});
		rotated += batchRotated;
	}
}

async function rotatePayloadSamples(): Promise<number> {
	let rotated = 0;
	while (true) {
		const rows = await db
			.select({ id: payloadSamples.id, envelope: payloadSamples.envelope })
			.from(payloadSamples)
			.where(
				sql`${payloadSamples.envelope}->>'kid' IS DISTINCT FROM ${activeEncryptionKeyId()}`,
			)
			.limit(BATCH_SIZE);
		if (rows.length === 0) {
			return rotated;
		}
		const batchRotated = await db.transaction(async (tx) => {
			let updatedCount = 0;
			for (const row of rows) {
				const value = decryptJson(row.envelope, "observability-payload");
				const updated = await tx
					.update(payloadSamples)
					.set({ envelope: encryptJson(value, "observability-payload") })
					.where(
						and(
							eq(payloadSamples.id, row.id),
							eq(payloadSamples.envelope, row.envelope),
						),
					)
					.returning({ id: payloadSamples.id });
				updatedCount += updated.length;
			}
			return updatedCount;
		});
		rotated += batchRotated;
	}
}

/**
 * Rows live a day, but a key retired within that day would leave their replays unreadable. Only
 * sealed responses are selected: an empty body is NULL, and a row from before responses were sealed
 * has no `kid` to rotate.
 */
async function rotateIdempotencyResponses(): Promise<number> {
	let rotated = 0;
	while (true) {
		const rows = await db
			.select({ id: idempotencyKeys.id, envelope: idempotencyKeys.response })
			.from(idempotencyKeys)
			.where(
				and(
					sql`${idempotencyKeys.response}->>'purpose' = ${IDEMPOTENCY_PURPOSE}`,
					sql`${idempotencyKeys.response}->>'kid' IS DISTINCT FROM ${activeEncryptionKeyId()}`,
				),
			)
			.limit(BATCH_SIZE);
		if (rows.length === 0) {
			return rotated;
		}
		const batchRotated = await db.transaction(async (tx) => {
			let updatedCount = 0;
			for (const row of rows) {
				const envelope = row.envelope as EncEnvelope;
				const value = decryptJson(envelope, IDEMPOTENCY_PURPOSE);
				const updated = await tx
					.update(idempotencyKeys)
					.set({ response: encryptJson(value, IDEMPOTENCY_PURPOSE) })
					.where(
						and(
							eq(idempotencyKeys.id, row.id),
							eq(idempotencyKeys.response, envelope),
						),
					)
					.returning({ id: idempotencyKeys.id });
				updatedCount += updated.length;
			}
			return updatedCount;
		});
		rotated += batchRotated;
	}
}

async function run(): Promise<void> {
	const [deployments, extensions, samples, idempotency] = await Promise.all([
		rotateDeployments(),
		rotateExtensions(),
		rotatePayloadSamples(),
		rotateIdempotencyResponses(),
	]);
	console.log(
		JSON.stringify({
			activeKeyId: activeEncryptionKeyId(),
			rotated: {
				deployments,
				extensions,
				payloadSamples: samples,
				idempotencyResponses: idempotency,
			},
		}),
	);
}

run()
	.then(() => closeDb())
	.catch(async (error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		try {
			await closeDb();
		} catch {
			// Already failing; a close error would only mask the rotation error above.
		}
		process.exit(1);
	});
