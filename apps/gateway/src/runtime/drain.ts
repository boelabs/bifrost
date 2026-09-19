/**
 * The shutdown sequence itself, expressed as ordered effects with no knowledge of signals, Postgres,
 * Redis or `process.exit`. `shutdown.ts` supplies the real ones.
 *
 * The order is the whole feature, so it is worth stating plainly. The naive version — close the
 * server the instant SIGTERM arrives — drops traffic, because nothing upstream knows yet: the proxy
 * is still routing to this container and its keep-alive pool still holds sockets to it. So:
 *
 *   1. mark the process `draining` — `/health/ready` starts answering 503 immediately
 *   2. stop background jobs and hang up idle long-lived connections (they cost nothing to reopen)
 *   3. WAIT `drainDelayMs` while still serving normally, so the proxy's health check observes the
 *      503 and takes this instance out of rotation. This step looks like a no-op and is the whole
 *      point: deregistration is asynchronous and there is no callback for it.
 *   4. stop accepting connections and let in-flight requests finish, up to `drainTimeoutMs`
 *   5. force whatever is left, flush the operation log, close dependencies
 *
 * The container runtime must allow at least `drainDelayMs + drainTimeoutMs + TEARDOWN_TIMEOUT_MS`
 * before it sends SIGKILL (`stop_grace_period` in Compose, "Stop Grace Period" in Coolify).
 * Otherwise this is killed mid-drain and none of it happened.
 */

/**
 * Budget for each teardown step that follows the drain: stopping jobs, flushing buffered operation
 * logs, closing dependencies. Not configurable — it is bounded work against things that are either
 * responsive or already gone, and a knob for it would only ever be tuned wrong.
 */
export const TEARDOWN_TIMEOUT_MS = 10_000;

/** Slack added to the absolute watchdog so it only fires when a phase deadline was missed. */
export const WATCHDOG_SLACK_MS = 5000;

export interface DrainTimings {
	/** Time spent unready but still serving, so the load balancer can deregister this instance. */
	drainDelayMs: number;
	/** Grace given to in-flight requests once the listener is closed. */
	drainTimeoutMs: number;
}

export interface DrainEffects {
	/** Flips the readiness answer to 503. Returns false when another drain already started. */
	beginDraining: () => boolean;
	/** Timers and pollers. Stopped as soon as draining starts: they are not traffic. */
	stopJobs: () => Promise<void>;
	/**
	 * Long-lived connections that will never end on their own (WebSockets). Called with
	 * `idleOnly: true` when the drain starts — a socket with no work in flight reconnects to the new
	 * instance for free — and with `idleOnly: false` when the drain window closes.
	 */
	releaseConnections: (options: { idleOnly: boolean }) => Promise<void>;
	/** Resolves when every in-flight request has finished and the listener is closed. */
	closeServer: () => Promise<void>;
	/** Drops whatever still holds a socket after the drain window. */
	closeAllConnections: () => void;
	/** Refuses new connections on idle keep-alive sockets before the listener closes. */
	closeIdleConnections: () => void;
	flushLogs: () => Promise<void>;
	closeDependencies: () => Promise<void>;
	sleep: (ms: number) => Promise<void>;
	onEvent: (event: DrainEvent, detail?: Record<string, unknown>) => void;
}

export type DrainEvent =
	| "already-draining"
	| "started"
	| "jobs-timeout"
	| "advertising-unreadiness"
	| "requests-timeout"
	| "flush-timeout"
	| "dependencies-timeout"
	| "failed"
	| "complete";

async function guard(
	task: Promise<void>,
	onFailure: (err: unknown) => void,
): Promise<void> {
	try {
		await task;
	} catch (err) {
		onFailure(err);
	}
}

async function withTimeout(
	task: Promise<void>,
	timeoutMs: number,
	onTimeout: () => void,
): Promise<void> {
	let timer: ReturnType<typeof setTimeout> | undefined;
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
		if (timer) {
			clearTimeout(timer);
		}
	}
}

/** Total time the sequence may take before the caller's watchdog should give up on it. */
export function drainBudgetMs(timings: DrainTimings): number {
	return (
		timings.drainDelayMs +
		timings.drainTimeoutMs +
		TEARDOWN_TIMEOUT_MS * 3 +
		WATCHDOG_SLACK_MS
	);
}

/**
 * Runs the sequence to completion. Never rejects: a shutdown that throws is a shutdown that hangs,
 * and every failure here is reported through `onEvent` and then stepped over.
 */
export async function runDrainSequence(
	effects: DrainEffects,
	timings: DrainTimings,
): Promise<void> {
	// `beginDraining` is the lock as well as the announcement: a second signal must not restart the
	// sequence halfway through it.
	if (!effects.beginDraining()) {
		effects.onEvent("already-draining");
		return;
	}
	const fail = (err: unknown) => effects.onEvent("failed", { err });
	effects.onEvent("started", { ...timings });

	await withTimeout(
		Promise.all([
			guard(effects.stopJobs(), fail),
			guard(effects.releaseConnections({ idleOnly: true }), fail),
		]).then(() => undefined),
		TEARDOWN_TIMEOUT_MS,
		() => effects.onEvent("jobs-timeout"),
	);

	// Still listening, still answering — only now with `/health/ready` at 503 and `Connection: close`
	// on every response, so the proxy drains its pool instead of reusing sockets that are about to
	// disappear.
	if (timings.drainDelayMs > 0) {
		effects.onEvent("advertising-unreadiness", {
			drainDelayMs: timings.drainDelayMs,
		});
		await effects.sleep(timings.drainDelayMs);
	}

	effects.closeIdleConnections();
	await withTimeout(
		guard(effects.closeServer(), fail),
		timings.drainTimeoutMs,
		() => effects.onEvent("requests-timeout", { ...timings }),
	);

	// Whether the drain finished or timed out, nothing may hold a socket past this point.
	await guard(effects.releaseConnections({ idleOnly: false }), fail);
	effects.closeAllConnections();

	await withTimeout(guard(effects.flushLogs(), fail), TEARDOWN_TIMEOUT_MS, () =>
		effects.onEvent("flush-timeout"),
	);
	await withTimeout(
		guard(effects.closeDependencies(), fail),
		TEARDOWN_TIMEOUT_MS,
		() => effects.onEvent("dependencies-timeout"),
	);
	effects.onEvent("complete");
}
