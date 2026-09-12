import { timingSafeEqual, randomBytes } from "node:crypto";

/**
 * Argon2id via Bun's native implementation — no dependency, and the parameters are the ones Bun
 * maintains. `verify` reads the algorithm from the stored digest, so raising the cost later only
 * requires re-hashing on the next successful login.
 */
const HASH_OPTIONS = { algorithm: "argon2id" } as const;

/** Minimum length accepted anywhere a human sets a password. */
export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(plaintext: string): Promise<string> {
	return Bun.password.hash(plaintext, HASH_OPTIONS);
}

/**
 * Verifies a password against a stored digest. Bun.password.verify is already constant-time for a
 * given digest; a malformed digest returns false instead of throwing so a corrupted row cannot 500
 * the login route.
 */
export async function verifyPassword(
	plaintext: string,
	digest: string,
): Promise<boolean> {
	try {
		return await Bun.password.verify(plaintext, digest);
	} catch {
		return false;
	}
}

/**
 * Constant-time comparison for the root password, which is a plain environment value rather than a
 * digest. Hashing it at boot would be pointless (the plaintext is already in memory), but comparing
 * it with === would leak its length and prefix through timing.
 */
export function verifyRootPassword(
	candidate: string,
	expected: string,
): boolean {
	const a = Buffer.from(candidate, "utf8");
	const b = Buffer.from(expected, "utf8");
	if (a.length !== b.length) {
		// Still burn a comparison so the mismatch costs the same as an equal-length one.
		timingSafeEqual(b, b);
		return false;
	}
	return timingSafeEqual(a, b);
}

/** 32 bytes of entropy, base64url. Used for session tokens and CSRF tokens. */
export function generateToken(): string {
	return randomBytes(32).toString("base64url");
}
