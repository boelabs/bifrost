import { z } from "zod";

export const PAGE_SIZE = 50;

/** The list's segments, read by the gateway as `enabled`; the first is the whole list. */
export const KEY_STATES = [
	{ value: "all", label: "All keys" },
	{ value: "enabled", label: "Enabled" },
	{ value: "disabled", label: "Disabled" },
] as const;

const schema = z.object({
	q: z.string().min(1).optional().catch(undefined),
	state: z.enum(["enabled", "disabled"]).optional().catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
});

export type KeysFilters = z.infer<typeof schema>;

/** A hand-edited query string is normal input: every field falls back rather than throwing. */
export function parseKeysFilters(
	params: Record<string, string | string[] | undefined>,
): KeysFilters {
	return schema.parse(params);
}

/** Whether the list is narrowed, so an empty page means "no matches" rather than "no keys". */
export function isFiltered(filters: KeysFilters): boolean {
	return Boolean(filters.q || filters.state);
}
