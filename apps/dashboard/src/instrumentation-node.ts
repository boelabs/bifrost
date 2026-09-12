import { assertConfigured } from "#/shared/config/server.ts";

/**
 * The only thing the dashboard needs from its environment is the gateway's address, and the only
 * useful moment to discover it is missing is before the first request.
 *
 * It exits rather than throwing. A thrown error here leaves Next listening and answering every
 * request with a 500 — the worst of both worlds, because the orchestrator sees a running container
 * while the operator sees a stack trace. Exiting makes it a start-up failure: a restart loop with
 * the reason in the logs, which every platform already knows how to report.
 */
try {
	assertConfigured();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
