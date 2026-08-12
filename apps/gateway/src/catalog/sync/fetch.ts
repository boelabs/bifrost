/**
 * Shared network resilience for catalog sources: hundreds of models x per-model "/endpoints" calls x
 * multiple sources, run from a shared CI runner IP, is a real rate-limit risk against public APIs. Every
 * source built on top of this gets bounded concurrency, retry+backoff on 429/5xx, and per-item failure
 * tracking for free instead of reimplementing it.
 */

const DEFAULT_RETRIES = 3;
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 8_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number): number {
	const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
	return Math.round(exponential * (0.5 + Math.random() * 0.5)); // +/- jitter, never below half
}

export class FetchRetryError extends Error {
	readonly url: string;
	readonly status: number | undefined;

	constructor(url: string, status: number | undefined, cause: unknown) {
		super(
			`Failed to fetch ${url}${status !== undefined ? ` (status ${status})` : ""}`,
			{ cause },
		);
		this.name = "FetchRetryError";
		this.url = url;
		this.status = status;
	}
}

/** GET `url` as JSON, retrying with exponential backoff + jitter on 429/5xx and on network errors. */
export async function fetchJsonWithRetry<T>(
	url: string,
	init?: RequestInit,
	retries: number = DEFAULT_RETRIES,
): Promise<T> {
	let lastError: unknown;
	let lastStatus: number | undefined;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const response = await fetch(url, init);
			if (response.ok) return (await response.json()) as T;
			lastStatus = response.status;
			// 4xx other than 429 is not going to succeed on retry (bad request/not found) - fail fast.
			if (response.status !== 429 && response.status < 500) {
				throw new FetchRetryError(url, response.status, undefined);
			}
			lastError = new FetchRetryError(url, response.status, undefined);
		} catch (err) {
			lastError = err;
			if (err instanceof FetchRetryError && err.status !== undefined) {
				if (err.status !== 429 && err.status < 500) throw err;
			}
		}
		if (attempt < retries) await sleep(backoffDelay(attempt));
	}
	throw new FetchRetryError(url, lastStatus, lastError);
}

export interface BoundedMapResult<T, R> {
	succeeded: Map<T, R>;
	failed: T[];
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight at once. A worker's failure (after its
 * own internal retries, e.g. via fetchJsonWithRetry) is caught and recorded in `failed` rather than
 * aborting the whole batch - one bad model id or a transient blip must never take down every other
 * item's result.
 */
export async function boundedMap<T, R>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T) => Promise<R>,
): Promise<BoundedMapResult<T, R>> {
	const succeeded = new Map<T, R>();
	const failed: T[] = [];
	let cursor = 0;

	async function runOne(): Promise<void> {
		while (cursor < items.length) {
			const index = cursor++;
			const item = items[index] as T;
			try {
				succeeded.set(item, await worker(item));
			} catch {
				failed.push(item);
			}
		}
	}

	const workers = Array.from(
		{ length: Math.min(concurrency, items.length) },
		() => runOne(),
	);
	await Promise.all(workers);
	return { succeeded, failed };
}

/** `complete` gate used by deprecate.ts: a run with too many failures must never read as "models are gone." */
export function isFetchComplete(
	attempted: number,
	failedCount: number,
): boolean {
	if (attempted === 0) return true;
	return failedCount / attempted <= 0.05;
}
