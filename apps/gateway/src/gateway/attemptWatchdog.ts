import type { ExecutionPolicy } from "#core/executionPolicy.ts";
import type { GatewayAbortReason } from "./abortReason.ts";

/**
 * Enforces one attempt's deadlines on the connection, the way an HTTP client's timeouts do.
 *
 * `response` runs from the start of the attempt until the upstream has answered: headers for a
 * stream, the complete body otherwise. `idle` then watches the stream for silence between bytes.
 * Expiry aborts the attempt's signal, which cancels the upstream request itself rather than only
 * the gateway's wait for it.
 */
export interface AttemptWatchdog {
	/** Upstream response headers arrived. */
	headers: () => void;
	/** Upstream bytes arrived. */
	bytes: () => void;
	/** The upstream response is complete; no deadline applies any longer. */
	complete: () => void;
	stop: () => void;
}

export function startAttemptWatchdog(
	policy: Pick<ExecutionPolicy, "responseMs" | "idleMs">,
	mode: "json" | "stream",
	abort: (reason: GatewayAbortReason) => void,
): AttemptWatchdog {
	let responseTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
		() => abort({ owner: "gateway", type: "timeout", phase: "response" }),
		policy.responseMs,
	);
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let lastByteAt = 0;
	let stopped = false;

	const clearResponse = () => {
		if (responseTimer) {
			clearTimeout(responseTimer);
			responseTimer = undefined;
		}
	};
	// One timer re-armed lazily: a byte only moves `lastByteAt`, and the timer, when it fires,
	// sleeps again for whatever silence budget is left.
	const armIdle = (delayMs: number) => {
		const { idleMs } = policy;
		if (idleMs === null || stopped) {
			return;
		}
		idleTimer = setTimeout(() => {
			const silentMs = Date.now() - lastByteAt;
			if (silentMs >= idleMs) {
				abort({ owner: "gateway", type: "timeout", phase: "idle" });
				return;
			}
			armIdle(idleMs - silentMs);
		}, delayMs);
	};

	return {
		headers() {
			if (mode !== "stream" || stopped) {
				return;
			}
			clearResponse();
			lastByteAt = Date.now();
			if (idleTimer === undefined && policy.idleMs !== null) {
				armIdle(policy.idleMs);
			}
		},
		bytes() {
			lastByteAt = Date.now();
		},
		complete() {
			stopped = true;
			clearResponse();
			if (idleTimer) {
				clearTimeout(idleTimer);
			}
		},
		stop() {
			this.complete();
		},
	};
}
