import { type RangeKey, rangeSchema } from "#/shared/lib/range.ts";
import { z } from "zod";

/**
 * The audit page's query string, described once.
 *
 * The page's Server Component parses the URL with this and the toolbar writes back to it, so the two
 * cannot drift — and because the URL is the only state, a filtered trail survives a reload and can
 * be handed to someone else as a link.
 */
export const PAGE_SIZE = 50;

/** The value a "no filter" option carries, since an empty string cannot be a `Select` value. */
export const ALL = "all";

export const KINDS = {
	admin: "Configuration changes",
	payload_access: "Payload reads",
} as const;

export const AUDIT_PERIODS = [
	"today",
	"yesterday",
	"7d",
	"30d",
	"custom",
	"all",
] as const satisfies readonly RangeKey[];

/**
 * The trail opens unbounded, unlike the tables that read operation rows.
 *
 * Entries are kept for a year and are consulted precisely when someone asks what happened months
 * ago; a seven-day default would answer that question with an empty table. The range is there to
 * narrow, not to hide.
 */
export const DEFAULT_PERIOD: RangeKey = "all";

const schema = z.object({
	kind: z.enum(["admin", "payload_access"]).optional().catch(undefined),
	actor: z.string().min(1).optional().catch(undefined),
	action: z.string().min(1).optional().catch(undefined),
	...rangeSchema(AUDIT_PERIODS),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
});

export type AuditFilters = z.infer<typeof schema>;

/**
 * A hand-edited query string is a normal thing to receive, so every field falls back to its default
 * rather than throwing — a nonsense `kind` shows the unfiltered trail, not an error page.
 */
export function parseAuditFilters(
	params: Record<string, string | string[] | undefined>,
): AuditFilters {
	return schema.parse(params);
}

export function isFiltered(filters: AuditFilters): boolean {
	return Boolean(
		filters.kind ||
			filters.actor ||
			filters.action ||
			(filters.period && filters.period !== DEFAULT_PERIOD),
	);
}
