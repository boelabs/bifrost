import { adminAudit, payloadAccessAudit } from "#db/schema.ts";
import type { Page, PageResult } from "./deployments.ts";
import { GatewayError } from "#core/errors.ts";
import { db } from "#db/client.ts";

import {
	type SQL,
	ilike,
	count,
	desc,
	and,
	gte,
	lte,
	eq,
	lt,
} from "drizzle-orm";

/**
 * Two tables, one timeline.
 *
 * `admin_audit` records every mutating /admin call; `payload_access_audit` records every read of a
 * retained prompt or completion. They are written by different middleware for different reasons, but
 * the question an operator asks is the same one — "who touched what, and when" — and answering it
 * from two separately paginated lists would put the burden of interleaving them on the reader.
 */
export type AuditKind = "admin" | "payload_access";

/** How far the two tables are read before they are interleaved. See `listAuditPage`. */
export const MAX_MERGE_DEPTH = 5_000;

export interface AuditEntry {
	id: string;
	at: Date;
	kind: AuditKind;
	actor: string;
	/** "POST /admin/keys" for an admin call; "READ payload" for a payload sample. */
	action: string;
	targetType: string | null;
	targetId: string | null;
	requestId: string | null;
	/** HTTP status of the audited call. Null for payload reads, which record found/not found instead. */
	status: number | null;
	ip: string | null;
	metadata: Record<string, unknown>;
}

export interface AuditFilter {
	/** Which table to read. Absent means both. */
	kind?: AuditKind;
	actor?: string;
	/** Substring of the action, e.g. "DELETE" or "/admin/keys". */
	action?: string;
	targetType?: string;
	start?: Date;
	end?: Date;
}

function adminConditions(filter: AuditFilter): SQL[] {
	const conds: SQL[] = [];
	if (filter.actor) conds.push(ilike(adminAudit.actor, `%${filter.actor}%`));
	if (filter.action) conds.push(ilike(adminAudit.action, `%${filter.action}%`));
	if (filter.targetType)
		conds.push(eq(adminAudit.targetType, filter.targetType));
	if (filter.start) conds.push(gte(adminAudit.at, filter.start));
	if (filter.end) conds.push(lte(adminAudit.at, filter.end));
	return conds;
}

/**
 * Payload reads have no method-and-path of their own, so the filters that are phrased in those terms
 * simply exclude them rather than matching everything: asking for "DELETE" and being handed a read is
 * worse than being handed nothing.
 */
function payloadConditions(filter: AuditFilter): SQL[] | null {
	const conds: SQL[] = [];
	if (filter.actor)
		conds.push(ilike(payloadAccessAudit.actor, `%${filter.actor}%`));
	if (filter.action && !"read payload".includes(filter.action.toLowerCase()))
		return null;
	if (filter.targetType && filter.targetType !== "operation") return null;
	if (filter.start)
		conds.push(gte(payloadAccessAudit.accessedAt, filter.start));
	if (filter.end) conds.push(lte(payloadAccessAudit.accessedAt, filter.end));
	return conds;
}

/**
 * One page of the merged timeline.
 *
 * The two tables are read separately and interleaved here rather than in a SQL union: each source is
 * asked for the newest `offset + limit` rows, which is exactly enough for the merged window to be
 * correct, and the row shapes stay typed instead of being flattened into a hand-written union whose
 * columns no compiler checks.
 */
export async function listAuditPage(
	opts: Page & AuditFilter,
): Promise<PageResult<AuditEntry>> {
	const depth = opts.offset + opts.limit;
	// Interleaving costs `depth` rows from each table, so an unbounded offset would let one request
	// pull the whole trail into memory. Past this point the answer is a narrower filter or a date
	// range, not another page — and saying so beats timing out.
	if (depth > MAX_MERGE_DEPTH)
		throw new GatewayError({
			class: "bad_request",
			code: "audit_offset_too_deep",
			message: `Audit offset ${opts.offset} exceeds the merge depth of ${MAX_MERGE_DEPTH}`,
			publicMessage: `The audit trail can be paged to ${MAX_MERGE_DEPTH} entries. Narrow the range or the filters to reach older entries.`,
			param: "offset",
		});
	const wantsAdmin = opts.kind !== "payload_access";
	const wantsPayload = opts.kind !== "admin";
	const payloadConds = wantsPayload ? payloadConditions(opts) : null;

	const adminConds = adminConditions(opts);
	const adminWhere = adminConds.length > 0 ? and(...adminConds) : undefined;
	const payloadWhere =
		payloadConds && payloadConds.length > 0 ? and(...payloadConds) : undefined;

	const [adminRows, adminTotal, payloadRows, payloadTotal] = await Promise.all([
		wantsAdmin
			? db
					.select()
					.from(adminAudit)
					.where(adminWhere)
					.orderBy(desc(adminAudit.at))
					.limit(depth)
			: Promise.resolve([]),
		wantsAdmin
			? db.select({ value: count() }).from(adminAudit).where(adminWhere)
			: Promise.resolve([{ value: 0 }]),
		payloadConds
			? db
					.select()
					.from(payloadAccessAudit)
					.where(payloadWhere)
					.orderBy(desc(payloadAccessAudit.accessedAt))
					.limit(depth)
			: Promise.resolve([]),
		payloadConds
			? db
					.select({ value: count() })
					.from(payloadAccessAudit)
					.where(payloadWhere)
			: Promise.resolve([{ value: 0 }]),
	]);

	const merged: AuditEntry[] = [
		...adminRows.map(
			(row): AuditEntry => ({
				id: row.id,
				at: row.at,
				kind: "admin",
				actor: row.actor,
				action: row.action,
				targetType: row.targetType,
				targetId: row.targetId,
				requestId: row.requestId,
				status: row.status,
				ip: row.ip,
				metadata: row.metadata,
			}),
		),
		...payloadRows.map(
			(row): AuditEntry => ({
				id: row.id,
				at: row.accessedAt,
				kind: "payload_access",
				actor: row.actor,
				action: "READ payload",
				targetType: "operation",
				targetId: row.operationId,
				requestId: row.requestId,
				status: null,
				ip: null,
				metadata: { found: row.found },
			}),
		),
	].sort((a, b) => b.at.getTime() - a.at.getTime());

	return {
		rows: merged.slice(opts.offset, depth),
		total:
			Number(adminTotal[0]?.value ?? 0) + Number(payloadTotal[0]?.value ?? 0),
	};
}

/**
 * Drops entries past the retention window.
 *
 * Payload reads are already purged with the operation metadata they refer to, on the observability
 * retention clock; this covers the configuration trail, whose rows are small and whose horizon is
 * measured in months rather than days.
 */
export async function purgeExpiredAuditEntries(before: Date): Promise<number> {
	const deleted = await db
		.delete(adminAudit)
		.where(lt(adminAudit.at, before))
		.returning({ id: adminAudit.id });
	return deleted.length;
}
