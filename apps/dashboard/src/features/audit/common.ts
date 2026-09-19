/**
 * `POST /admin/keys` → `POST` + `/admin/keys`, so a table can weight the verb differently.
 *
 * Split out of `api.ts` because the audit table is a Client Component: `api.ts` reads cookies through
 * `next/headers` and cannot cross that boundary, while this is a pure string function.
 */
export function splitAction(action: string): {
	method: string | null;
	path: string;
} {
	const [first, ...rest] = action.split(" ");
	if (rest.length === 0) {
		return { method: null, path: action };
	}
	return { method: first ?? null, path: rest.join(" ") };
}

/**
 * The table's column headers, kept here rather than beside the columns themselves: the page is a
 * Server Component and its `<Suspense>` fallback needs them, and a Server Component cannot read a
 * runtime value out of a `"use client"` module. Both sides import this one list, so the skeleton
 * and the real table cannot drift apart.
 */
export const AUDIT_HEADERS = [
	"When",
	"Actor",
	"Action",
	"Target",
	"Kind",
	"Result",
	"IP",
] as const;
