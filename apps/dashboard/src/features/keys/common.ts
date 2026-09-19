import type { components } from "#/shared/api/schema";

/**
 * The virtual-key vocabulary and the one formatter over it, in a module with no server import.
 *
 * `api.ts` reads cookies through `next/headers`, so a Client Component cannot touch it. Anything the
 * dialog and the table need on both sides of that boundary lives here instead.
 */
export type VirtualKey = components["schemas"]["VirtualKey"];
export type CreatedVirtualKey = components["schemas"]["CreatedVirtualKey"];
export type CreateKeyInput = components["schemas"]["CreateKey"];
export type UpdateKeyInput = components["schemas"]["UpdateKey"];

/** Cents are stored with 10 decimal places; render money, not a raw numeric string. */
export function formatCents(value: string | number | null | undefined): string {
	if (value === null || value === undefined) {
		return "—";
	}
	const cents = typeof value === "string" ? Number.parseFloat(value) : value;
	if (!Number.isFinite(cents)) {
		return "—";
	}
	return `$${(cents / 100).toFixed(cents < 100 ? 4 : 2)}`;
}

/**
 * The table's column headers, kept here rather than beside the columns themselves: the page is a
 * Server Component and its `<Suspense>` fallback needs them, and a Server Component cannot read a
 * runtime value out of a `"use client"` module. Both sides import this one list, so the skeleton
 * and the real table cannot drift apart.
 */
export const KEY_HEADERS = [
	"Name",
	"Models",
	"Spend",
	"Limits",
	"Expires",
	"State",
	"",
] as const;
