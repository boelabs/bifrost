/**
 * Process lifecycle state, readable from anywhere without importing the shutdown machinery.
 *
 * It exists for one reason: a load balancer learns that an instance is going away by *polling*, so
 * the instance has to say so before it stops accepting connections. `/health/ready` reads this, the
 * HTTP layer reads it to hang up keep-alive connections, and `shutdown.ts` writes it.
 */

export type LifecyclePhase = "running" | "draining";

let phase: LifecyclePhase = "running";
let drainingSince: number | null = null;

/**
 * Marks the process as leaving the rotation. Idempotent: the first call wins, so a second signal
 * cannot restart the clock. Returns false when the process was already draining.
 */
export function beginDraining(): boolean {
	if (phase === "draining") {
		return false;
	}
	phase = "draining";
	drainingSince = Date.now();
	return true;
}

export function lifecyclePhase(): LifecyclePhase {
	return phase;
}

export function isDraining(): boolean {
	return phase === "draining";
}

/** Milliseconds since draining started, or null while the process is still in rotation. */
export function drainingForMs(): number | null {
	return drainingSince === null ? null : Date.now() - drainingSince;
}

/** Test-only: restores the initial state between cases. */
export function resetLifecycleForTests(): void {
	phase = "running";
	drainingSince = null;
}
