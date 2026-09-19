import { purgeDeadSessions } from "#db/repos/dashboardSessions.ts";
import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";

const INTERVAL_MS = 3_600_000;
/** Revoked rows are kept this long so the audit trail can still resolve a session id. */
const REVOKED_GRACE_MS = 7 * 24 * 3_600_000;

/**
 * In-process GC for `dashboard_sessions`, matching how the gateway runs every other maintenance job
 * (see AGENTS.md — background jobs are in-process, never cron). No-op when the dashboard is off.
 */
export function startDashboardSessionGcJob(): () => void {
	if (!env.DASH_ENABLED) {
		return () => {};
	}
	const run = (): void => {
		void purgeDeadSessions(new Date(Date.now() - REVOKED_GRACE_MS))
			.then((deleted) => {
				if (deleted > 0) {
					log.info("dashboard-sessions", "gc deleted dead rows", { deleted });
				}
			})
			.catch((err: unknown) => {
				log.error("dashboard-sessions", "gc failed", { err });
			});
	};
	run();
	const timer = setInterval(run, INTERVAL_MS);
	timer.unref();
	return () => clearInterval(timer);
}
