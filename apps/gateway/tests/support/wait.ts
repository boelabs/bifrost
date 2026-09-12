export interface EventuallyOptions {
	description: string;
	timeoutMs?: number;
	intervalMs?: number;
}

const sleep = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Small poller for async fire-and-forget effects in integration tests (logs, cache, Redis).
 * `probe` must return null/undefined until the value exists.
 */
export async function eventually<T>(
	probe: () => T | null | undefined | Promise<T | null | undefined>,
	options: EventuallyOptions,
): Promise<T> {
	const timeoutMs = options.timeoutMs ?? 4000;
	const intervalMs = options.intervalMs ?? 50;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await probe();
		if (value !== null && value !== undefined) return value;
		await sleep(intervalMs);
	}
	throw new Error(`Timed out waiting for ${options.description}`);
}
