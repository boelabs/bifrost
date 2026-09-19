import { sql as drizzleSql, type SQL, count, desc, and, eq } from "drizzle-orm";
import type { Page, PageResult } from "./deployments.ts";
import type { DashboardRole } from "#auth/roles.ts";
import { dashboardUsers } from "#db/schema.ts";
import { writtenRow } from "#db/returning.ts";
import { db } from "#db/client.ts";

export type DashboardUserRow = typeof dashboardUsers.$inferSelect;

export interface DashboardUserListFilter {
	role?: DashboardRole;
	enabled?: boolean;
	q?: string;
}

export async function listDashboardUsersPage(
	opts: Page & DashboardUserListFilter,
): Promise<PageResult<DashboardUserRow>> {
	const conds: SQL[] = [];
	if (opts.role !== undefined) {
		conds.push(eq(dashboardUsers.role, opts.role));
	}
	if (opts.enabled !== undefined) {
		conds.push(eq(dashboardUsers.enabled, opts.enabled));
	}
	if (opts.q) {
		conds.push(
			drizzleSql`lower(${dashboardUsers.username}) LIKE lower(${`%${opts.q}%`})`,
		);
	}
	const where = conds.length > 0 ? and(...conds) : undefined;
	const [rows, totalRow] = await Promise.all([
		db
			.select()
			.from(dashboardUsers)
			.where(where)
			.orderBy(desc(dashboardUsers.createdAt))
			.limit(opts.limit)
			.offset(opts.offset),
		db.select({ value: count() }).from(dashboardUsers).where(where),
	]);
	return { rows, total: Number(totalRow[0]?.value ?? 0) };
}

export async function getDashboardUserById(
	id: string,
): Promise<DashboardUserRow | null> {
	const [row] = await db
		.select()
		.from(dashboardUsers)
		.where(eq(dashboardUsers.id, id))
		.limit(1);
	return row ?? null;
}

/** Lookup by login identifier. Usernames are unique case-insensitively. */
export async function getDashboardUserByUsername(
	username: string,
): Promise<DashboardUserRow | null> {
	const [row] = await db
		.select()
		.from(dashboardUsers)
		.where(drizzleSql`lower(${dashboardUsers.username}) = lower(${username})`)
		.limit(1);
	return row ?? null;
}

export interface CreateDashboardUserInput {
	username: string;
	passwordHash: string;
	role: DashboardRole;
	mustChangePassword?: boolean;
	createdBy: string;
}

export async function createDashboardUser(
	input: CreateDashboardUserInput,
): Promise<DashboardUserRow> {
	const [row] = await db
		.insert(dashboardUsers)
		.values({
			username: input.username,
			passwordHash: input.passwordHash,
			role: input.role,
			createdBy: input.createdBy,
			...(input.mustChangePassword === undefined
				? {}
				: { mustChangePassword: input.mustChangePassword }),
		})
		.returning();
	return writtenRow(row, "createDashboardUser");
}

export interface UpdateDashboardUserInput {
	username?: string;
	passwordHash?: string;
	role?: DashboardRole;
	enabled?: boolean;
	mustChangePassword?: boolean;
}

export async function updateDashboardUser(
	id: string,
	patch: UpdateDashboardUserInput,
): Promise<DashboardUserRow | null> {
	const [row] = await db
		.update(dashboardUsers)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(dashboardUsers.id, id))
		.returning();
	return row ?? null;
}

export async function touchDashboardUserLogin(id: string): Promise<void> {
	await db
		.update(dashboardUsers)
		.set({ lastLoginAt: new Date() })
		.where(eq(dashboardUsers.id, id));
}

/** Sessions cascade with the row, so deleting a user revokes their access atomically. */
export async function deleteDashboardUser(id: string): Promise<void> {
	await db.delete(dashboardUsers).where(eq(dashboardUsers.id, id));
}
