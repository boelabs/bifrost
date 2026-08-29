export interface AsyncTtlCache<T> {
	get(): Promise<T>;
	invalidate(): void;
}

/** Small process-local cache that coalesces concurrent loads and never caches failures. */
export function createAsyncTtlCache<T>(
	load: () => Promise<T>,
	ttlMs: number,
	now: () => number = Date.now,
): AsyncTtlCache<T> {
	let generation = 0;
	let cached: { value: T; expiresAt: number } | undefined;
	let inFlight: { generation: number; promise: Promise<T> } | undefined;

	return {
		async get() {
			const currentGeneration = generation;
			if (cached && cached.expiresAt > now()) return cached.value;
			if (inFlight?.generation === currentGeneration) return inFlight.promise;

			const promise = load();
			inFlight = { generation: currentGeneration, promise };
			try {
				const value = await promise;
				if (generation === currentGeneration) {
					cached = { value, expiresAt: now() + ttlMs };
				}
				return value;
			} finally {
				if (inFlight?.promise === promise) inFlight = undefined;
			}
		},
		invalidate() {
			generation += 1;
			cached = undefined;
		},
	};
}
