/** Helpers for hermetic adapter/endpoint tests that call upstream through `fetch`. */

export type FetchStub = (
	...args: Parameters<typeof fetch>
) => Response | Promise<Response>;

/** Replaces `globalThis.fetch` during a block and restores it even if the test fails. */
export async function withStubbedFetch<T>(
	stub: FetchStub,
	run: () => T | Promise<T>,
): Promise<T> {
	const original = globalThis.fetch;
	globalThis.fetch = (async (...args) => stub(...args)) as typeof fetch;
	try {
		return await run();
	} finally {
		globalThis.fetch = original;
	}
}

export function jsonResponse(
	body: unknown,
	status = 200,
	headers: Record<string, string> = {},
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});
}
