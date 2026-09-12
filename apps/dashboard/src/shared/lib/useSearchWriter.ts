"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

/** `undefined`, `null` and `""` all mean "drop this parameter", so "all" reads as absent. */
export type Query = Record<string, string | number | undefined | null>;

/**
 * Filters, in the URL — written here, read on the server.
 *
 * The URL is the single source of truth for what a table is showing, and the page's Server Component
 * is the only thing that parses it: each page has a zod schema, and the values it produces arrive
 * here as `current`. That is not just tidiness. `useSearchParams()` resolves only at request time, so
 * a control that called it would be pulled out of the route's prerendered shell and into a fallback
 * on every cold load; taking the values as props keeps the controls in the shell and leaves exactly
 * one place where a query string is interpreted.
 *
 * Writing goes through a transition, which is what keeps the current rows on screen while the server
 * re-renders — without it, every keystroke in a search field would drop the table to its skeleton.
 */
export function useSearchWriter(current: Query) {
	const pathname = usePathname();
	const router = useRouter();
	const [pending, startTransition] = useTransition();

	const go = useCallback(
		(next: Query) => {
			const params = new URLSearchParams();
			for (const [key, value] of Object.entries(next)) {
				if (value === undefined || value === null || value === "") continue;
				params.set(key, String(value));
			}
			const query = params.toString();
			startTransition(() =>
				router.push(query ? `${pathname}?${query}` : pathname, {
					scroll: false,
				}),
			);
		},
		[pathname, router],
	);

	/** Merges a patch into the current query. */
	const set = useCallback(
		(patch: Query) => go({ ...current, ...patch }),
		[current, go],
	);

	/**
	 * Changing a filter starts the listing over: page 4 of the old filter means nothing under the
	 * new one, so the offset goes with it.
	 */
	const filter = useCallback(
		(patch: Query) => go({ ...current, ...patch, offset: undefined }),
		[current, go],
	);

	/** Drops every parameter except the ones named. */
	const clear = useCallback(
		(keep: readonly string[] = []) =>
			go(Object.fromEntries(keep.map((key) => [key, current[key]]))),
		[current, go],
	);

	return { set, filter, clear, pending };
}
