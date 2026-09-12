/**
 * Role model for human operators. Three roles, deliberately coarse: this is a single-tenant gateway
 * and per-resource ACLs would outgrow their usefulness long before anyone needed them.
 *
 * The three capabilities that separate `admin` from `owner` are the ones that are dangerous rather
 * than merely destructive:
 *  - `extensions`: uploaded modules run IN-PROCESS with no sandbox. It is remote code execution by
 *    design (see docs/extensions).
 *  - `payloads`: retained request/response samples are real prompts and completions — the most
 *    sensitive data the gateway holds, which is why reading one is itself audited.
 *  - `users`: whoever manages roles can grant themselves the other two.
 *
 * `audit:read` is owner-only for the same reason: the trail is the record of who used those three,
 * and an account that can read it should not be one that can be handed out casually.
 */
export type DashboardRole = "owner" | "admin" | "viewer";

export const DASHBOARD_ROLES = ["owner", "admin", "viewer"] as const;

export type Permission =
	| "deployments:read"
	| "deployments:write"
	| "keys:read"
	| "keys:write"
	| "usage:read"
	| "logs:read"
	| "payloads:read"
	| "inference:use"
	| "settings:read"
	| "settings:write"
	| "extensions:manage"
	| "users:manage"
	| "audit:read";

const VIEWER: readonly Permission[] = [
	"deployments:read",
	"usage:read",
	"settings:read",
];

const ADMIN: readonly Permission[] = [
	...VIEWER,
	"deployments:write",
	"keys:read",
	"keys:write",
	"logs:read",
	"payloads:read",
	"inference:use",
	"settings:write",
];

const OWNER: readonly Permission[] = [
	...ADMIN,
	"extensions:manage",
	"users:manage",
	"audit:read",
];

const BY_ROLE: Record<DashboardRole, readonly Permission[]> = {
	viewer: VIEWER,
	admin: ADMIN,
	owner: OWNER,
};

export function permissionsFor(role: DashboardRole): readonly Permission[] {
	return BY_ROLE[role];
}

export function roleHas(role: DashboardRole, permission: Permission): boolean {
	return BY_ROLE[role].includes(permission);
}
