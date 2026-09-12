import { dashboardSettings } from "#db/schema.ts";
import { db } from "#db/client.ts";
import { eq } from "drizzle-orm";

export type DashboardSettingsRow = typeof dashboardSettings.$inferSelect;

/**
 * The values a caller may change. `id` and `updatedAt` are not among them, and every field is
 * explicitly `| undefined` so a partial patch satisfies `exactOptionalPropertyTypes`.
 */
export interface DashboardSettingsPatch {
	sessionTtlMinutes?: number | undefined;
	sessionIdleMinutes?: number | undefined;
	loginMaxAttempts?: number | undefined;
	loginLockoutMinutes?: number | undefined;
}

/**
 * Memoised for a few seconds, because the idle check runs on every authenticated request and this
 * is a singleton row that changes about once a year. A write clears it, so an operator editing the
 * policy sees it applied immediately; other replicas pick it up within the window.
 */
const CACHE_MS = 5_000;
let cached: { row: DashboardSettingsRow; readAt: number } | undefined;

export async function getDashboardSettings(): Promise<DashboardSettingsRow> {
	if (cached && Date.now() - cached.readAt < CACHE_MS) return cached.row;
	const [row] = await db
		.select()
		.from(dashboardSettings)
		.where(eq(dashboardSettings.id, 1))
		.limit(1);
	if (!row)
		throw new Error(
			"dashboard_settings has no row 1; the migration seeds it, so the database is behind.",
		);
	cached = { row, readAt: Date.now() };
	return row;
}

export async function updateDashboardSettings(
	patch: DashboardSettingsPatch,
): Promise<DashboardSettingsRow> {
	const [row] = await db
		.update(dashboardSettings)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(dashboardSettings.id, 1))
		.returning();
	if (!row) throw new Error("dashboard_settings has no row 1");
	cached = { row, readAt: Date.now() };
	return row;
}

/** For tests, which change the policy between cases. */
export function forgetDashboardSettings(): void {
	cached = undefined;
}
