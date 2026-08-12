/**
 * Global test guard: by default, no test can use `fetch` for real network access.
 *
 * Tests that exercise adapters/endpoints must use `withStubbedFetch()` and return a
 * synthetic response. This lets e2e/integration tests validate routing, logging, cache, and
 * contracts without real provider credentials or an internet dependency.
 *
 * Explicit escape hatch for one-off manual tests:
 *   ALLOW_TEST_NETWORK=1 bun run test
 */

function describeFetchTarget(input: Parameters<typeof fetch>[0]): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.href;
	if (typeof input === "object" && input !== null && "url" in input) {
		return String(input.url);
	}
	return String(input);
}

if (!["1", "true", "yes"].includes(process.env.ALLOW_TEST_NETWORK ?? "")) {
	globalThis.fetch = (async (input) => {
		throw new Error(
			`[test] Real fetch blocked: ${describeFetchTarget(input)}. ` +
				"Use withStubbedFetch() from #test-support/fetch.ts to simulate the upstream.",
		);
	}) as typeof fetch;
}

export {};
