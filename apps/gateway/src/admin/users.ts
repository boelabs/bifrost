import { hashPassword, MIN_PASSWORD_LENGTH } from "#auth/password.ts";
import { requirePermission, getAuth } from "#auth/middleware.ts";
import { invalidateSessionCaches } from "#auth/session.ts";
import { type AppEnv, actorOf } from "#auth/types.ts";
import { DASHBOARD_ROLES } from "#auth/roles.ts";
import { ok, paginated } from "#http/respond.ts";
import { GatewayError } from "#core/errors.ts";
import { parseJsonBody } from "#http/body.ts";
import { Hono } from "hono";
import * as z from "zod/v4";

import {
	getDashboardUserByUsername,
	listDashboardUsersPage,
	type DashboardUserRow,
	getDashboardUserById,
	createDashboardUser,
	updateDashboardUser,
	deleteDashboardUser,
} from "#db/repos/dashboardUsers.ts";

import {
	revokeSessionsForUser,
	listSessionsForUser,
} from "#db/repos/dashboardSessions.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** Usernames are login identifiers, not display names: no spaces, no case games. */
const USERNAME = /^[a-zA-Z0-9._-]{3,64}$/;

const createUserSchema = z.object({
	username: z
		.string()
		.regex(USERNAME, "username must match ^[a-zA-Z0-9._-]{3,64}$"),
	password: z.string().min(MIN_PASSWORD_LENGTH),
	role: z.enum(DASHBOARD_ROLES),
	mustChangePassword: z.boolean().optional(),
});

const updateUserSchema = z
	.object({
		role: z.enum(DASHBOARD_ROLES).optional(),
		enabled: z.boolean().optional(),
		mustChangePassword: z.boolean().optional(),
	})
	.strict();

const setPasswordSchema = z.object({
	password: z.string().min(MIN_PASSWORD_LENGTH),
	mustChangePassword: z.boolean().optional(),
});

/** Strips the digest before returning a user. */
function publicUser(row: DashboardUserRow) {
	const { passwordHash: _omit, ...rest } = row;
	return rest;
}

async function requireUser(id: string): Promise<DashboardUserRow> {
	const row = await getDashboardUserById(id);
	if (!row)
		throw new GatewayError({
			class: "not_found",
			message: `Dashboard user "${id}" does not exist`,
		});
	return row;
}

/** Kills every live session of a user and clears their cache entries. */
async function revokeAll(userId: string): Promise<void> {
	const revoked = await revokeSessionsForUser(userId);
	await invalidateSessionCaches(revoked.map((row) => row.tokenHash));
}

export const dashboardUsersApp = new Hono<AppEnv>();

// Managing users means managing roles, which is how any other permission could be granted.
dashboardUsersApp.use("*", requirePermission("users:manage"));

dashboardUsersApp.get("/", async (c) => {
	const rawLimit = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
	const rawOffset = Number(c.req.query("offset") ?? 0);
	const limit =
		Number.isFinite(rawLimit) && rawLimit > 0
			? Math.min(Math.trunc(rawLimit), MAX_LIMIT)
			: DEFAULT_LIMIT;
	const offset =
		Number.isFinite(rawOffset) && rawOffset >= 0 ? Math.trunc(rawOffset) : 0;
	const role = c.req.query("role");
	if (role !== undefined && !DASHBOARD_ROLES.includes(role as never)) {
		throw new GatewayError({
			class: "bad_request",
			message: `Invalid role "${role}". Allowed: ${DASHBOARD_ROLES.join(", ")}`,
			param: "role",
		});
	}
	const q = c.req.query("q");
	const { rows, total } = await listDashboardUsersPage({
		limit,
		offset,
		...(role ? { role: role as (typeof DASHBOARD_ROLES)[number] } : {}),
		...(q ? { q } : {}),
	});
	return paginated(c, rows.map(publicUser), {
		limit,
		offset,
		total,
		nextOffset: offset + limit < total ? offset + limit : null,
	});
});

// Creation is admin-only by construction: there is no public sign-up route anywhere in the gateway.
dashboardUsersApp.post("/", async (c) => {
	const input = await parseJsonBody(c, createUserSchema);
	if (await getDashboardUserByUsername(input.username)) {
		throw new GatewayError({
			class: "bad_request",
			code: "username_taken",
			message: `Username "${input.username}" is already in use`,
			param: "username",
		});
	}
	const row = await createDashboardUser({
		username: input.username,
		passwordHash: await hashPassword(input.password),
		role: input.role,
		createdBy: actorOf(getAuth(c)),
		...(input.mustChangePassword !== undefined
			? { mustChangePassword: input.mustChangePassword }
			: {}),
	});
	return ok(c, publicUser(row), 201);
});

dashboardUsersApp.get("/:id", async (c) =>
	ok(c, publicUser(await requireUser(c.req.param("id")))),
);

dashboardUsersApp.get("/:id/sessions", async (c) => {
	const user = await requireUser(c.req.param("id"));
	const rows = await listSessionsForUser(user.id);
	// Never return tokenHash: it is the credential's stored form.
	return ok(
		c,
		rows.map(({ tokenHash: _omit, ...rest }) => rest),
	);
});

dashboardUsersApp.patch("/:id", async (c) => {
	const user = await requireUser(c.req.param("id"));
	const input = await parseJsonBody(c, updateUserSchema);
	const row = await updateDashboardUser(user.id, {
		...(input.role !== undefined ? { role: input.role } : {}),
		...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
		...(input.mustChangePassword !== undefined
			? { mustChangePassword: input.mustChangePassword }
			: {}),
	});
	// A demotion or a disable must take effect now, not whenever the session happened to expire.
	if (
		(input.role !== undefined && input.role !== user.role) ||
		input.enabled === false
	)
		await revokeAll(user.id);
	return ok(c, publicUser(row!));
});

dashboardUsersApp.post("/:id/password", async (c) => {
	const user = await requireUser(c.req.param("id"));
	const input = await parseJsonBody(c, setPasswordSchema);
	await updateDashboardUser(user.id, {
		passwordHash: await hashPassword(input.password),
		mustChangePassword: input.mustChangePassword ?? true,
	});
	await revokeAll(user.id);
	return c.body(null, 204);
});

dashboardUsersApp.delete("/:id", async (c) => {
	const user = await requireUser(c.req.param("id"));
	await revokeAll(user.id);
	await deleteDashboardUser(user.id);
	return c.body(null, 204);
});
