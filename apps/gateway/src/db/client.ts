import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "#config/env.ts";
import postgres from "postgres";

/**
 * Does the URL request TLS? (sslmode=require|verify-*|prefer). Some hosts (e.g. Coolify) expose
 * Postgres with self-signed certificates whose SAN does not include the IP, so we use postgres-js's
 * `ssl: "require"`: it encrypts but does not verify the certificate. On an internal network (no
 * sslmode) the connection is plaintext.
 */
const wantsSsl = /sslmode=(require|verify-full|verify-ca|prefer)/i.test(
	env.DATABASE_URL,
);

export const sql = postgres(env.DATABASE_URL, {
	max: 10,
	onnotice: () => {},
	ssl: wantsSsl ? "require" : false,
});

export const db = drizzle(sql);

/** Health ping: SELECT 1. */
export async function pingDb(): Promise<boolean> {
	try {
		await sql`select 1`;
		return true;
	} catch {
		return false;
	}
}

export async function closeDb(timeoutSeconds = 5): Promise<void> {
	await sql.end({ timeout: timeoutSeconds });
}
