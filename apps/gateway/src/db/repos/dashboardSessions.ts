import { isNull, desc, and, gt, eq, lt, or } from "drizzle-orm";
import type { DashboardRole } from "#auth/roles.ts";
import { dashboardSessions } from "#db/schema.ts";
import { writtenRow } from "#db/returning.ts";
import { createHash } from "node:crypto";
import { db } from "#db/client.ts";

export type DashboardSessionRow = typeof dashboardSessions.$inferSelect;

/** Sessions are stored hashed for the same reason virtual keys are: a database dump is not a key ring. */
export function hashSessionToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export interface CreateDashboardSessionInput {
	tokenHash: string;
	/** NULL for the environment-backed root operator. */
	userId: string | null;
	role: DashboardRole;
	expiresAt: Date;
	ip: string | null;
	userAgent: string | null;
}

export async function createDashboardSession(
	input: CreateDashboardSessionInput,
): Promise<DashboardSessionRow> {
	const [row] = await db.insert(dashboardSessions).values(input).returning();
	return writtenRow(row, "createDashboardSession");
}

/** Returns the session only when it is live: not revoked and not past its absolute expiry. */
export async function getLiveSessionByHash(
	tokenHash: string,
): Promise<DashboardSessionRow | null> {
	const [row] = await db
		.select()
		.from(dashboardSessions)
		.where(
			and(
				eq(dashboardSessions.tokenHash, tokenHash),
				isNull(dashboardSessions.revokedAt),
				gt(dashboardSessions.expiresAt, new Date()),
			),
		)
		.limit(1);
	return row ?? null;
}

export async function touchDashboardSession(id: string): Promise<void> {
	await db
		.update(dashboardSessions)
		.set({ lastSeenAt: new Date() })
		.where(eq(dashboardSessions.id, id));
}

export async function revokeDashboardSession(id: string): Promise<void> {
	await db
		.update(dashboardSessions)
		.set({ revokedAt: new Date() })
		.where(eq(dashboardSessions.id, id));
}

/** Revokes every live session of a user. Used on disable, role change, and password change. */
export async function revokeSessionsForUser(
	userId: string,
): Promise<DashboardSessionRow[]> {
	return db
		.update(dashboardSessions)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(dashboardSessions.userId, userId),
				isNull(dashboardSessions.revokedAt),
			),
		)
		.returning();
}

export async function listSessionsForUser(
	userId: string,
): Promise<DashboardSessionRow[]> {
	return db
		.select()
		.from(dashboardSessions)
		.where(
			and(
				eq(dashboardSessions.userId, userId),
				isNull(dashboardSessions.revokedAt),
				gt(dashboardSessions.expiresAt, new Date()),
			),
		)
		.orderBy(desc(dashboardSessions.lastSeenAt));
}

/**
 * Deletes rows that can no longer authenticate anything: expired, or revoked before the cutoff.
 * Revoked rows linger briefly so the audit trail can still resolve them.
 */
export async function purgeDeadSessions(revokedBefore: Date): Promise<number> {
	const rows = await db
		.delete(dashboardSessions)
		.where(
			or(
				lt(dashboardSessions.expiresAt, new Date()),
				lt(dashboardSessions.revokedAt, revokedBefore),
			),
		)
		.returning({ id: dashboardSessions.id });
	return rows.length;
}
