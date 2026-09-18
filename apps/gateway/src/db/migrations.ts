import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./client.ts";
import { join } from "node:path";

/**
 * Applies pending Drizzle migrations, safely enough to run from every replica's boot.
 *
 * Drizzle's migrator takes no lock of its own: it reads the last applied migration, works out what
 * is pending, and applies it. Two processes starting together therefore read the same state and try
 * to apply the same DDL, and the loser fails on a relation that now already exists. A Postgres
 * advisory lock serialises them — the second waits for the first, then finds nothing pending and
 * returns immediately.
 *
 * Migrations are tracked in `drizzle.__drizzle_migrations` and generated from `schema.ts` with
 * `bun run db:generate`. Applying them is idempotent; once applied, a migration is immutable and a
 * correction ships as a new one.
 */
const MIGRATIONS_DIR = join(import.meta.dirname, "migrations");

/**
 * Identifies the lock among all advisory locks in this database. The value is arbitrary and means
 * nothing — it only has to be the same number in every process that migrates.
 */
const MIGRATION_LOCK_ID = 918_273_645;

export async function runMigrations(): Promise<void> {
	// A session-level advisory lock belongs to the connection that took it, and the pool would hand
	// the unlock to a different one — so the lock is held on a connection reserved for it. The
	// migration itself runs on the pool; the lock only has to exist while it does.
	const holder = await sql.reserve();
	try {
		await holder`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
		await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
	} finally {
		// Releasing is a courtesy: the lock dies with the connection either way, and a failure here
		// must not mask the migration error this block may be unwinding.
		await holder`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(
			() => undefined,
		);
		holder.release();
	}
}
