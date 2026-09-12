import { env } from "#config/env.ts";

import {
	createDecipheriv,
	createCipheriv,
	randomBytes,
	hkdfSync,
} from "node:crypto";

export type EncryptionPurpose =
	| "deployment-credentials"
	| "extension-source"
	| "observability-payload"
	| "response-compaction";

function parseKeyring(raw: string): ReadonlyMap<string, Buffer> {
	const parsed = JSON.parse(raw) as Record<string, string>;
	const entries = Object.entries(parsed).map(
		([id, hex]) => [id, Buffer.from(hex, "hex")] as const,
	);
	const keyring = new Map(entries);
	if (!keyring.has(env.ACTIVE_ENCRYPTION_KEY_ID)) {
		throw new Error(
			`ACTIVE_ENCRYPTION_KEY_ID "${env.ACTIVE_ENCRYPTION_KEY_ID}" is absent from ENCRYPTION_KEYRING`,
		);
	}
	return keyring;
}

const KEYRING = parseKeyring(env.ENCRYPTION_KEYRING);
const ACTIVE_KEY_ID = env.ACTIVE_ENCRYPTION_KEY_ID;

export interface EncEnvelope {
	/** Envelope schema version. Version 2 intentionally has no compatibility decoder. */
	v: 2;
	alg: "A256GCM";
	kid: string;
	purpose: EncryptionPurpose;
	/** Base64 IV. */
	iv: string;
	/** Base64 GCM auth tag. */
	tag: string;
	/** Base64 ciphertext. */
	ct: string;
}

export function parseEncryptedEnvelope(value: unknown): EncEnvelope {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("Encrypted envelope must be an object");
	const candidate = value as Partial<EncEnvelope>;
	if (
		candidate.v !== 2 ||
		candidate.alg !== "A256GCM" ||
		typeof candidate.kid !== "string" ||
		!KEYRING.has(candidate.kid) ||
		![
			"deployment-credentials",
			"extension-source",
			"observability-payload",
			"response-compaction",
		].includes(candidate.purpose ?? "") ||
		typeof candidate.iv !== "string" ||
		typeof candidate.tag !== "string" ||
		typeof candidate.ct !== "string" ||
		Buffer.from(candidate.iv, "base64").byteLength !== 12 ||
		Buffer.from(candidate.tag, "base64").byteLength !== 16
	)
		throw new Error(
			"Encrypted envelope is invalid or references an unavailable key",
		);
	return candidate as EncEnvelope;
}

function aad(
	envelope: Pick<EncEnvelope, "v" | "alg" | "kid" | "purpose">,
): Buffer {
	return Buffer.from(
		`${envelope.v}:${envelope.alg}:${envelope.kid}:${envelope.purpose}`,
		"utf8",
	);
}

function keyFor(id: string): Buffer {
	const key = KEYRING.get(id);
	if (!key)
		throw new Error(
			`Encryption key "${id}" is not present in ENCRYPTION_KEYRING`,
		);
	return key;
}

export function encryptJson(
	value: unknown,
	purpose: EncryptionPurpose,
): EncEnvelope {
	const iv = randomBytes(12);
	const header = { v: 2, alg: "A256GCM", kid: ACTIVE_KEY_ID, purpose } as const;
	const cipher = createCipheriv("aes-256-gcm", keyFor(ACTIVE_KEY_ID), iv);
	cipher.setAAD(aad(header));
	const plaintext = Buffer.from(JSON.stringify(value), "utf8");
	const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	const tag = cipher.getAuthTag();
	return {
		...header,
		iv: iv.toString("base64"),
		tag: tag.toString("base64"),
		ct: ct.toString("base64"),
	};
}

export function decryptJson(
	envelope: EncEnvelope,
	expectedPurpose: EncryptionPurpose,
): unknown {
	envelope = parseEncryptedEnvelope(envelope);
	if (
		envelope.v !== 2 ||
		envelope.alg !== "A256GCM" ||
		envelope.purpose !== expectedPurpose
	) {
		throw new Error(
			"Encrypted envelope version, algorithm, or purpose is invalid",
		);
	}
	const decipher = createDecipheriv(
		"aes-256-gcm",
		keyFor(envelope.kid),
		Buffer.from(envelope.iv, "base64"),
	);
	decipher.setAAD(aad(envelope));
	decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(envelope.ct, "base64")),
		decipher.final(),
	]);
	return JSON.parse(plaintext.toString("utf8")) as unknown;
}

export function activeEncryptionKeyId(): string {
	return ACTIVE_KEY_ID;
}

export function deriveActiveKey(purpose: string): Buffer {
	return Buffer.from(
		hkdfSync(
			"sha256",
			keyFor(ACTIVE_KEY_ID),
			Buffer.from("bifrost-keyring-v2"),
			Buffer.from(purpose),
			32,
		),
	);
}

export function decryptRecord(
	envelope: EncEnvelope,
	purpose: EncryptionPurpose,
): Record<string, unknown> {
	const value = decryptJson(envelope, purpose);
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error(`Encrypted ${purpose} payload must be an object`);
	return value as Record<string, unknown>;
}

export function decryptString(
	envelope: EncEnvelope,
	purpose: EncryptionPurpose,
): string {
	const value = decryptJson(envelope, purpose);
	if (typeof value !== "string")
		throw new Error(`Encrypted ${purpose} payload must be a string`);
	return value;
}
