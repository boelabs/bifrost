import { and, eq, isNotNull, sql } from "drizzle-orm";
import { closeDb, db } from "#db/client.ts";

import {
	activeEncryptionKeyId,
	decryptRecord,
	decryptString,
	decryptJson,
	encryptJson,
} from "#db/crypto.ts";

import {
	extensionArtifacts,
	modelDeployments,
	payloadSamples,
	virtualKeys,
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

async function rotateVirtualKeySecrets(): Promise<number> {
	let rotated = 0;
	while (true) {
		// A private key has no envelope, and NULL is distinct from every key id: without the
		// IS NOT NULL the same private rows would come back forever.
		const rows = await db
			.select({ id: virtualKeys.id, envelope: virtualKeys.secret })
			.from(virtualKeys)
			.where(
				and(
					isNotNull(virtualKeys.secret),
					sql`${virtualKeys.secret}->>'kid' IS DISTINCT FROM ${activeEncryptionKeyId()}`,
				),
			)
			.limit(BATCH_SIZE);
		if (rows.length === 0) {
			return rotated;
		}
		const batchRotated = await db.transaction(async (tx) => {
			let updatedCount = 0;
			for (const row of rows) {
				if (row.envelope === null) {
					continue;
				}
				const value = decryptString(row.envelope, "virtual-key-secret");
				const updated = await tx
					.update(virtualKeys)
					.set({ secret: encryptJson(value, "virtual-key-secret") })
					.where(
						and(
							eq(virtualKeys.id, row.id),
							eq(virtualKeys.secret, row.envelope),
						),
					)
					.returning({ id: virtualKeys.id });
				updatedCount += updated.length;
			}
			return updatedCount;
		});
		rotated += batchRotated;
	}
}

async function run(): Promise<void> {
	const [deployments, extensions, samples, keys] = await Promise.all([
		rotateDeployments(),
		rotateExtensions(),
		rotatePayloadSamples(),
		rotateVirtualKeySecrets(),
	]);
	console.log(
		JSON.stringify({
			activeKeyId: activeEncryptionKeyId(),
			rotated: {
				deployments,
				extensions,
				payloadSamples: samples,
				virtualKeys: keys,
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
