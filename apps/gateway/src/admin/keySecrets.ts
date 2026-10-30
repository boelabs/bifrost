import { getVirtualKeySecret, hashVirtualKey } from "#db/repos/virtualKeys.ts";
import { decryptString } from "#db/crypto.ts";
import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";

/** Whether this deployment lets anyone copy a stored key at all. */
export function keySecretAccessIsOpen(): boolean {
	return env.VIRTUAL_KEY_SECRET_ACCESS === "open";
}

export type KeySecretRead =
	| { outcome: "revealed"; key: string }
	/** VIRTUAL_KEY_SECRET_ACCESS=sealed: refused before the row is read. */
	| { outcome: "sealed" }
	| { outcome: "not_found" }
	/** The key was issued private, or made private since: there is nothing to decrypt. */
	| { outcome: "private" }
	/** Sealed with a key the keyring no longer has, or no longer the secret of this key. */
	| { outcome: "unreadable" };

/**
 * Decrypts one key's stored secret, or explains why it cannot.
 *
 * Refusal comes first and costs nothing: a sealed gateway answers without reading the row, so the
 * plaintext never exists in this process.
 *
 * The decrypted value is checked against the hash authentication uses. The envelope's authenticated
 * data names its purpose, not its row, so this is what guarantees that what an operator copies is
 * the key that works today — not one moved over from another row, nor one a rotation replaced.
 */
export async function revealKeySecret(id: string): Promise<KeySecretRead> {
	if (!keySecretAccessIsOpen()) {
		return { outcome: "sealed" };
	}
	const row = await getVirtualKeySecret(id);
	if (!row) {
		return { outcome: "not_found" };
	}
	if (row.secret === null) {
		return { outcome: "private" };
	}
	let key: string;
	try {
		key = decryptString(row.secret, "virtual-key-secret");
	} catch (err) {
		log.warn("keys", "a stored virtual key secret could not be decrypted", {
			err,
			keyId: id,
			kid: row.secret.kid,
		});
		return { outcome: "unreadable" };
	}
	if (hashVirtualKey(key) !== row.keyHash) {
		log.error("keys", "a stored virtual key secret does not match its hash", {
			keyId: id,
		});
		return { outcome: "unreadable" };
	}
	return { outcome: "revealed", key };
}
