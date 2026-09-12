import { purgeExpiredIdempotencyKeys } from "#db/repos/idempotency.ts";
import { log } from "#logging/log.ts";

const INTERVAL_MS = 3_600_000;

/**
 * In-process GC for `idempotency_keys`, matching how the gateway runs every other maintenance job
 * (see AGENTS.md — background jobs are in-process, never cron). Rows are only useful for as long as a
 * client might retry; past that they are a record of requests nobody will make again.
 */
export function startIdempotencyGcJob(): () => void {
	const run = (): void => {
		void purgeExpiredIdempotencyKeys()
			.then((deleted) => {
				if (deleted > 0)
					log.info("idempotency", "gc deleted expired keys", { deleted });
			})
			.catch((err: unknown) => {
				log.error("idempotency", "gc failed", { err });
			});
	};
	run();
	const timer = setInterval(run, INTERVAL_MS);
	timer.unref();
	return () => clearInterval(timer);
}
