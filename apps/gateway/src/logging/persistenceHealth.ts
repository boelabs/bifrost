export interface PersistenceRuntimeState {
	pending: number;
	queueDepth: number;
	queueCapacity: number;
	encryptedSampling: boolean;
}

export interface PersistenceHealthStatus extends PersistenceRuntimeState {
	status: "ready" | "degraded";
	healthy: boolean;
	failureTotal: number;
	dropTotal: number;
	consecutiveFailures: number;
	lastFailureAt: string | null;
	lastDropAt: string | null;
	lastSuccessAt: string | null;
}

/** Tracks both lifetime loss counters and the recoverable current persistence condition. */
export class PersistenceHealthTracker {
	readonly #now: () => number;
	#failureTotal = 0;
	#dropTotal = 0;
	#consecutiveFailures = 0;
	#lastFailureAt: number | null = null;
	#lastDropAt: number | null = null;
	#lastSuccessAt: number | null = null;
	#eventOrdinal = 0;
	#lastIssueOrdinal = 0;
	#lastSuccessOrdinal = 0;

	constructor(now: () => number = Date.now) {
		this.#now = now;
	}

	recordSuccess(): void {
		this.#eventOrdinal += 1;
		this.#lastSuccessOrdinal = this.#eventOrdinal;
		this.#lastSuccessAt = this.#now();
		this.#consecutiveFailures = 0;
	}

	recordFailure(): void {
		this.#eventOrdinal += 1;
		this.#lastIssueOrdinal = this.#eventOrdinal;
		this.#failureTotal += 1;
		this.#consecutiveFailures += 1;
		this.#lastFailureAt = this.#now();
	}

	recordDrop(): void {
		this.#eventOrdinal += 1;
		this.#lastIssueOrdinal = this.#eventOrdinal;
		this.#dropTotal += 1;
		this.#lastDropAt = this.#now();
	}

	status(runtime: PersistenceRuntimeState): PersistenceHealthStatus {
		const recovered =
			this.#lastIssueOrdinal === 0 ||
			this.#lastSuccessOrdinal > this.#lastIssueOrdinal;
		const queueHealthy =
			runtime.queueDepth < Math.ceil(runtime.queueCapacity * 0.8);
		const healthy = runtime.encryptedSampling && recovered && queueHealthy;
		const iso = (value: number | null) =>
			value === null ? null : new Date(value).toISOString();
		return {
			...runtime,
			status: healthy ? "ready" : "degraded",
			healthy,
			failureTotal: this.#failureTotal,
			dropTotal: this.#dropTotal,
			consecutiveFailures: this.#consecutiveFailures,
			lastFailureAt: iso(this.#lastFailureAt),
			lastDropAt: iso(this.#lastDropAt),
			lastSuccessAt: iso(this.#lastSuccessAt),
		};
	}
}
