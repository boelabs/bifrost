import { runMigrations } from "./migrations.ts";
import { closeDb } from "./client.ts";

/**
 * Applies pending migrations and exits. The gateway does this itself at boot (`MIGRATE_ON_BOOT`),
 * so this entrypoint is for the cases where that is not wanted: applying a schema change ahead of a
 * rollout, or a deployment that runs migrations as its own step.
 *
 * Both paths take the same advisory lock, so running this while replicas are booting is safe.
 */
runMigrations()
	.then(() => {
		console.log("[migrate] done (up to date)");
		return closeDb();
	})
	.then(() => process.exit(0))
	.catch(async (err) => {
		console.error(
			"[migrate] FAILED:",
			err instanceof Error ? err.message : err,
		);
		await closeDb().catch(() => {});
		process.exit(1);
	});
