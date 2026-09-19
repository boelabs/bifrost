import { beginDraining, isDraining } from "#runtime/lifecycle.ts";
import { flushOperationLogs } from "#logging/operations.ts";
import { shutdownTelemetry } from "#telemetry/index.ts";
import type { ServerType } from "@hono/node-server";
import { closeRedis } from "#cache/redis.ts";
import { closeDb } from "#db/client.ts";
import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";

import {
	runDrainSequence,
	type DrainEvent,
	drainBudgetMs,
} from "#runtime/drain.ts";

/**
 * Signal handling and the real effects behind the drain. The ordering — and the reasoning for it —
 * lives in `drain.ts`.
 */

type ClosableServer = ServerType & {
	close: (callback?: (err?: Error) => void) => void;
	closeIdleConnections?: () => void;
	closeAllConnections?: () => void;
};

export interface GracefulShutdownOptions {
	server: ServerType;
	/** Timers and pollers. Stopped as soon as draining starts: they are not traffic. */
	stopJobs?: Array<() => void | Promise<void>>;
	/** WebSockets and anything else that would otherwise hold the process open indefinitely. */
	releaseConnections?: (options: { idleOnly: boolean }) => void | Promise<void>;
}

function closeServer(server: ClosableServer): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((err?: Error) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
}

/** Events the sequence reports, mapped to the level they deserve in the log. */
const EVENT_LEVEL: Record<DrainEvent, "info" | "error"> = {
	"already-draining": "info",
	started: "info",
	"advertising-unreadiness": "info",
	complete: "info",
	"jobs-timeout": "error",
	"requests-timeout": "error",
	"flush-timeout": "error",
	"dependencies-timeout": "error",
	failed: "error",
};

const EVENT_MESSAGE: Record<DrainEvent, string> = {
	"already-draining": "signal ignored; already draining",
	started: "draining",
	"advertising-unreadiness":
		"unready to the load balancer; still serving in-flight traffic",
	complete: "complete",
	"jobs-timeout": "background jobs exceeded the deadline",
	"requests-timeout":
		"in-flight requests exceeded the drain window; forcing connections",
	"flush-timeout": "operation-log flush exceeded the deadline",
	"dependencies-timeout": "dependency shutdown exceeded the deadline",
	failed: "a shutdown step failed; continuing",
};

export function installGracefulShutdown(
	options: GracefulShutdownOptions,
): void {
	const server = options.server as ClosableServer;
	const timings = {
		drainDelayMs: env.DRAIN_DELAY_MS,
		drainTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
	};

	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		// Last resort: a step that hangs past its own deadline must not hold the container open until
		// the runtime SIGKILLs it, because that also kills the log line explaining what happened.
		const watchdog = setTimeout(() => {
			log.error(
				"shutdown",
				"watchdog fired; exiting without a clean teardown",
				{
					signal,
				},
			);
			process.exit(0);
		}, drainBudgetMs(timings));
		watchdog.unref?.();

		await runDrainSequence(
			{
				beginDraining,
				stopJobs: async () => {
					await Promise.all(
						(options.stopJobs ?? []).map(async (stopJob) => {
							await Promise.resolve(stopJob()).catch((err: unknown) => {
								log.error("shutdown", "job stop failed", { err });
							});
						}),
					);
				},
				releaseConnections: async (releaseOptions) => {
					await Promise.resolve(options.releaseConnections?.(releaseOptions));
				},
				closeServer: () => closeServer(server),
				closeIdleConnections: () => server.closeIdleConnections?.(),
				closeAllConnections: () => server.closeAllConnections?.(),
				flushLogs: () => flushOperationLogs(),
				closeDependencies: async () => {
					await Promise.allSettled([
						closeRedis(),
						closeDb(),
						shutdownTelemetry(),
					]);
				},
				sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
				onEvent: (event, detail) => {
					log[EVENT_LEVEL[event]]("shutdown", EVENT_MESSAGE[event], {
						signal,
						...detail,
					});
				},
			},
			timings,
		);

		clearTimeout(watchdog);
		process.exit(0);
	};

	// `on`, not `once`: a repeated signal has to be swallowed here, because Node's default handler
	// for an unhandled SIGTERM terminates the process — which is exactly what the drain prevents.
	const handle = (signal: NodeJS.Signals): void => {
		if (isDraining()) {
			log.info("shutdown", "signal ignored; already draining", { signal });
			return;
		}
		void shutdown(signal);
	};
	process.on("SIGTERM", handle);
	process.on("SIGINT", handle);
}
