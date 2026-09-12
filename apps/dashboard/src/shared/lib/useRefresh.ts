"use client";

import { useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Re-reads a page's Server Components.
 *
 * `router.refresh()` is the whole data path: the page's async components run again on the server and
 * React swaps the result in, so a table is showing what the gateway actually holds rather than a
 * hand-patched cache. The transition is what keeps the current data on screen while the new data is
 * fetched — without it the page would fall back to its skeleton on every refresh, including every
 * auto-refresh tick.
 */
export function useRefresh(): { refresh: () => void; pending: boolean } {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const refresh = useCallback(
		() => startTransition(() => router.refresh()),
		[router],
	);
	return { refresh, pending };
}
