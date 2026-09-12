import { z } from "zod";

export const PAGE_SIZE = 50;

const schema = z.object({
	q: z.string().min(1).optional().catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
});

export type KeysFilters = z.infer<typeof schema>;

/** A hand-edited query string is normal input: every field falls back rather than throwing. */
export function parseKeysFilters(
	params: Record<string, string | string[] | undefined>,
): KeysFilters {
	return schema.parse(params);
}
