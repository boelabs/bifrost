import { flushOperationLogs } from "#logging/operations.ts";
import { shutdownTelemetry } from "#telemetry/index.ts";
import type { ServerType } from "@hono/node-server";
import { closeRedis } from "#cache/redis.ts";
import { closeDb } from "#db/client.ts";
import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";

type ClosableServer = ServerType & {
	close: (callback?: (err?: Error) => void) => void;
	closeIdleConnections?: () => void;
	closeAllConnections?: () => void;
};

export interface GracefulShutdownOptions {
	server: ServerType;
	stopJobs?: Array<() => void | Promise<void>>;
}

function closeServer(server: ClosableServer): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((err?: Error) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

async function runWithTimeout(
	task: Promise<void>,
	timeoutMs: number,
	onTimeout: () => void,
): Promise<void> {
	let timer: NodeJS.Timeout | undefined;
	try {
		await Promise.race([
			task,
			new Promise<void>((resolve) => {
				timer = setTimeout(() => {
					onTimeout();
					resolve();
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function installGracefulShutdown(
	options: GracefulShutdownOptions,
): void {
	const server = options.server as ClosableServer;
	let shuttingDown = false;

	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (shuttingDown) return;
		shuttingDown = true;
		const deadlineAt = Date.now() + env.SHUTDOWN_TIMEOUT_MS;
		const remainingMs = () => Math.max(0, deadlineAt - Date.now());
		log.info("shutdown", `received ${signal}; draining server`, { signal });

		await runWithTimeout(
			Promise.all(
				(options.stopJobs ?? []).map(async (stopJob) => {
					await Promise.resolve(stopJob()).catch((err: unknown) => {
						log.error("shutdown", "job stop failed", { err });
					});
				}),
			).then(() => undefined),
			remainingMs(),
			() => log.error("shutdown", "job shutdown exceeded the deadline"),
		);

		server.closeIdleConnections?.();
		await runWithTimeout(closeServer(server), remainingMs(), () => {
			log.error(
				"shutdown",
				`drain exceeded the ${env.SHUTDOWN_TIMEOUT_MS}ms shutdown deadline; forcing connections`,
			);
			server.closeAllConnections?.();
		}).catch((err: unknown) => {
			log.error("shutdown", "server close failed", { err });
		});

		await runWithTimeout(flushOperationLogs(), remainingMs(), () => {
			log.error(
				"shutdown",
				"operation-log flush exceeded the shutdown deadline",
			);
		}).catch((err: unknown) => {
			log.error("shutdown", "operation-log flush failed", { err });
		});
		await runWithTimeout(
			Promise.allSettled([closeRedis(), closeDb(), shutdownTelemetry()]).then(
				() => undefined,
			),
			remainingMs(),
			() => log.error("shutdown", "dependency shutdown exceeded the deadline"),
		);
		log.info("shutdown", "complete");
		process.exit(0);
	};

	process.once("SIGTERM", (signal) => void shutdown(signal));
	process.once("SIGINT", (signal) => void shutdown(signal));
}
