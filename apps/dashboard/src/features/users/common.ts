import type { components } from "#/shared/api/schema";

/**
 * The operator vocabulary, in a module with no server import — the tables and dialogs on this page
 * are Client Components, and `api.ts` reads cookies through `next/headers`.
 */
export type DashboardUser = components["schemas"]["DashboardUser"];
export type DashboardSession = components["schemas"]["DashboardSession"];
export type Role = DashboardUser["role"];

export const ROLES: Role[] = ["owner", "admin", "viewer"];

/**
 * What each role can reach, mirrored from the gateway's auth/roles.ts. Shown while granting a role so
 * an owner can see what they are handing over; the gateway remains the enforcer.
 */
export const ROLE_SUMMARY: Record<Role, string> = {
	viewer:
		"Reads models, usage and settings. No keys, no logs, no prompt content, no inference.",
	admin:
		"Everything a viewer can do, plus writes, virtual keys, logs, payload samples and the playground.",
	owner:
		"Everything, plus runtime extensions (which execute code in-process) and user management.",
};

/**
 * The table's column headers, kept here rather than beside the columns themselves: the page is a
 * Server Component and its `<Suspense>` fallback needs them, and a Server Component cannot read a
 * runtime value out of a `"use client"` module. Both sides import this one list, so the skeleton
 * and the real table cannot drift apart.
 */
export const USER_HEADERS = [
	"Username",
	"Role",
	"State",
	"Password",
	"Last login",
	"Created by",
	"",
] as const;
