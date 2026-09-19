import { setCookie, getCookie, deleteCookie } from "hono/cookie";
import { authMiddleware, getAuth } from "./middleware.ts";
import { env, rootCredentials } from "#config/env.ts";
import { clientIp } from "#endpoints/shared.ts";
import { GatewayError } from "#core/errors.ts";
import { parseJsonBody } from "#http/body.ts";
import { permissionsFor } from "./roles.ts";
import type { AppEnv } from "./types.ts";
import { ok } from "#http/respond.ts";
import { Hono } from "hono";
import * as z from "zod/v4";

import {
	getDashboardUserByUsername,
	touchDashboardUserLogin,
	getDashboardUserById,
	updateDashboardUser,
} from "#db/repos/dashboardUsers.ts";

import {
	invalidateSessionCaches,
	SESSION_COOKIE,
	issueSession,
	CSRF_COOKIE,
	endSession,
} from "./session.ts";

import {
	MIN_PASSWORD_LENGTH,
	verifyRootPassword,
	verifyPassword,
	hashPassword,
} from "./password.ts";

import {
	assertLoginAllowed,
	recordLoginFailure,
	clearLoginFailures,
} from "./loginThrottle.ts";

import {
	revokeSessionsForUser,
	hashSessionToken,
} from "#db/repos/dashboardSessions.ts";

const loginSchema = z.object({
	username: z.string().min(1),
	password: z.string().min(1),
});

const changePasswordSchema = z.object({
	currentPassword: z.string().min(1),
	newPassword: z.string().min(MIN_PASSWORD_LENGTH),
});

/** One generic failure for every rejected login: never reveal whether the username exists. */
function invalidCredentials(): GatewayError {
	return new GatewayError({
		class: "auth",
		code: "invalid_credentials",
		message: "Invalid username or password",
		publicMessage: "Invalid username or password.",
	});
}

function writeSessionCookies(
	c: import("hono").Context<AppEnv>,
	token: string,
	csrfToken: string,
	expiresAt: Date,
): void {
	// The session cookie is httpOnly so page scripts cannot read or exfiltrate it. The CSRF cookie
	// deliberately is NOT: the page must read it to echo it back in the X-CSRF-Token header.
	setCookie(c, SESSION_COOKIE, token, {
		httpOnly: true,
		secure: env.NODE_ENV === "production",
		sameSite: "Lax",
		path: "/",
		expires: expiresAt,
	});
	setCookie(c, CSRF_COOKIE, csrfToken, {
		httpOnly: false,
		secure: env.NODE_ENV === "production",
		sameSite: "Lax",
		path: "/",
		expires: expiresAt,
	});
}

export const authApp = new Hono<AppEnv>();

/* ------------------------------------------------------------------ login */

authApp.post("/session", async (c) => {
	const input = await parseJsonBody(c, loginSchema);
	const ip = clientIp(c);
	await assertLoginAllowed(input.username, ip);

	const root = rootCredentials;
	const isRootLogin =
		root !== null &&
		input.username.toLowerCase() === root.user.toLowerCase() &&
		verifyRootPassword(input.password, root.password);

	let userId: string | null = null;
	let role: "owner" | "admin" | "viewer" = "owner";
	let mustChangePassword = false;

	if (isRootLogin) {
		// Root is the environment, not a row: it cannot be disabled, demoted, or deleted.
		userId = null;
		role = "owner";
	} else {
		const user = await getDashboardUserByUsername(input.username);
		// Verify against a real digest even for an unknown username, so the response time does not
		// disclose whether the account exists.
		const digest =
			user?.passwordHash ??
			"$argon2id$v=19$m=65536,t=2,p=1$aaaaaaaaaaaaaaaa$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const valid = await verifyPassword(input.password, digest);
		if (!(user?.enabled && valid)) {
			await recordLoginFailure(input.username, ip);
			throw invalidCredentials();
		}
		userId = user.id;
		role = user.role;
		mustChangePassword = user.mustChangePassword;
		await touchDashboardUserLogin(user.id);
	}

	await clearLoginFailures(input.username, ip);

	const issued = await issueSession({
		userId,
		role,
		ip,
		userAgent: c.req.header("user-agent") ?? null,
	});
	writeSessionCookies(c, issued.token, issued.csrfToken, issued.expiresAt);

	return ok(
		c,
		{
			user: {
				id: userId,
				username: isRootLogin ? root!.user : input.username,
				role,
				isRoot: isRootLogin,
				mustChangePassword,
			},
			permissions: permissionsFor(role),
			expiresAt: issued.expiresAt.toISOString(),
		},
		201,
	);
});

/* ----------------------------------------------------------------- whoami */

authApp.get("/session", authMiddleware(), async (c) => {
	const auth = getAuth(c);
	if (auth.type !== "session") {
		throw new GatewayError({
			class: "permission",
			message: "Not an operator session",
		});
	}
	const { session } = auth;
	const user =
		session.userId === null ? null : await getDashboardUserById(session.userId);
	return ok(c, {
		user: {
			id: session.userId,
			username: user?.username ?? rootCredentials?.user ?? null,
			role: session.role,
			isRoot: session.isRoot,
			mustChangePassword: user?.mustChangePassword ?? false,
		},
		permissions: permissionsFor(session.role),
	});
});

/* ----------------------------------------------------------------- logout */

authApp.delete("/session", async (c) => {
	const token = getCookie(c, SESSION_COOKIE);
	if (token) {
		await endSession(token);
	}
	// The attributes must match the ones the cookie was set with, or the browser treats this as a
	// different cookie and leaves the original in place — a logout that does not log anyone out.
	const clear = {
		path: "/",
		secure: env.NODE_ENV === "production",
		sameSite: "Lax",
	} as const;
	deleteCookie(c, SESSION_COOKIE, clear);
	deleteCookie(c, CSRF_COOKIE, clear);
	return c.body(null, 204);
});

/* -------------------------------------------------------- change password */

authApp.post("/password", authMiddleware(), async (c) => {
	const auth = getAuth(c);
	if (auth.type !== "session" || auth.session.userId === null) {
		throw new GatewayError({
			class: "permission",
			code: "root_password_immutable",
			message:
				"The root operator's password is set through DASH_ROOT_PASSWORD, not through the API",
		});
	}
	const input = await parseJsonBody(c, changePasswordSchema);
	const user = await getDashboardUserById(auth.session.userId);
	if (
		!(user && (await verifyPassword(input.currentPassword, user.passwordHash)))
	) {
		throw invalidCredentials();
	}

	await updateDashboardUser(user.id, {
		passwordHash: await hashPassword(input.newPassword),
		mustChangePassword: false,
	});
	// Every other session of this user dies with the old password; the current one is reissued so the
	// operator is not logged out by their own password change.
	const revoked = await revokeSessionsForUser(user.id);
	await invalidateSessionCaches(revoked.map((row) => row.tokenHash));

	const issued = await issueSession({
		userId: user.id,
		role: user.role,
		ip: clientIp(c),
		userAgent: c.req.header("user-agent") ?? null,
	});
	writeSessionCookies(c, issued.token, issued.csrfToken, issued.expiresAt);
	return ok(c, { expiresAt: issued.expiresAt.toISOString() });
});

/* ---------------------------------------------------------------- config */

/**
 * Unauthenticated bootstrap probe for a front-end: whether human auth exists at all. It exposes no
 * usernames, no counts, and nothing that is not already implied by the login form rendering.
 *
 * Mounted at /auth/config, NOT under /dashboard: a deployment that serves a UI owns that whole path.
 */
export function dashboardConfigHandler(c: import("hono").Context<AppEnv>) {
	return ok(c, {
		enabled: env.DASH_ENABLED,
		authMethods: env.DASH_ENABLED ? ["password"] : [],
	});
}

export { hashSessionToken };
