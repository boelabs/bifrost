/**
 * Short-lived, in-process cache for the routing configuration every request reads (deployments,
 * fallback chains). Writes through the repositories clear it at once on this replica; other
 * replicas converge within the TTL, the same window the router settings already use.
 *
 * Entries hold the pending promise, so a burst of requests for one model shares a single query.
 */
export class ConfigCache<T> {
	readonly #entries = new Map<string, { at: number; value: Promise<T> }>();
	readonly #ttlMs: number;
	readonly #maxEntries: number;

	// Callers may ask for names that do not exist; the bound keeps that from growing the map.
	constructor(ttlMs = 5000, maxEntries = 2000) {
		this.#ttlMs = ttlMs;
		this.#maxEntries = maxEntries;
	}

	get(key: string, load: () => Promise<T>): Promise<T> {
		const hit = this.#entries.get(key);
		if (hit && Date.now() - hit.at < this.#ttlMs) {
			return hit.value;
		}
		if (this.#entries.size >= this.#maxEntries) {
			this.#entries.clear();
		}
		const value = load();
		const entry = { at: Date.now(), value };
		this.#entries.set(key, entry);
		value.catch(() => {
			if (this.#entries.get(key) === entry) {
				this.#entries.delete(key);
			}
		});
		return value;
	}

	clear(): void {
		this.#entries.clear();
	}
}
