import assert from "node:assert/strict";
import { test } from "node:test";

import "#adapters/index.ts";

import { pgAvailable, redisAvailable } from "#test-support/infra.ts";
import { makeGatewayTestApp } from "#test-support/app.ts";
import { adminApp } from "#admin/index.ts";
import { authApp } from "#auth/routes.ts";
import { env } from "#config/env.ts";

const skip =
	(await pgAvailable()) && (await redisAvailable())
		? false
		: "Postgres or Redis unavailable";

const app = makeGatewayTestApp((a) => {
	a.route("/auth", authApp);
	a.route("/admin", adminApp);
});

const masterAuth = { authorization: `Bearer ${env.MASTER_KEY}` };
const USERNAME = `itest-user-${Date.now()}`;
const PASSWORD = "an-integration-password";

interface Cookies {
	session: string;
	csrf: string;
}

/** Extracts both cookies from a login response so a test can act as that operator. */
function readCookies(res: Response): Cookies {
	const raw = res.headers.getSetCookie();
	const find = (name: string): string => {
		const header = raw.find((value) => value.startsWith(`${name}=`));
		assert.ok(header, `expected a ${name} cookie`);
		return header.slice(name.length + 1).split(";")[0]!;
	};
	return { session: find("bifrost_session"), csrf: find("bifrost_csrf") };
}

function asOperator(
	cookies: Cookies,
	extra: Record<string, string> = {},
): Record<string, string> {
	return {
		cookie: `bifrost_session=${cookies.session}; bifrost_csrf=${cookies.csrf}`,
		"x-csrf-token": cookies.csrf,
		...extra,
	};
}

async function login(username: string, password: string): Promise<Response> {
	return app.request("/auth/session", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ username, password }),
	});
}

test("dashboard auth: root session, roles, CSRF, and revocation", {
	skip,
}, async (t) => {
	let createdUserId: string | undefined;
	t.after(async () => {
		if (createdUserId) {
			await app.request(`/admin/users/${createdUserId}`, {
				method: "DELETE",
				headers: masterAuth,
			});
		}
	});

	/* ---- the root operator authenticates from the environment, with no row ---- */

	const rootLogin = await login(
		env.DASH_ROOT_USER!,
		env.DASH_ROOT_PASSWORD ?? env.MASTER_KEY,
	);
	assert.equal(rootLogin.status, 201);
	const rootBody = (await rootLogin.json()) as {
		data: { user: { isRoot: boolean; id: string | null; role: string } };
	};
	assert.equal(rootBody.data.user.isRoot, true);
	assert.equal(rootBody.data.user.id, null);
	assert.equal(rootBody.data.user.role, "owner");
	const root = readCookies(rootLogin);

	const whoami = await app.request("/auth/session", {
		headers: asOperator(root),
	});
	assert.equal(whoami.status, 200);

	/* ---- a wrong password is rejected generically ---- */

	const bad = await login(env.DASH_ROOT_USER!, "definitely-not-the-password");
	assert.equal(bad.status, 401);

	/* ---- CSRF is required on mutations authenticated by the cookie ---- */

	const noCsrf = await app.request("/admin/users", {
		method: "POST",
		headers: {
			cookie: `bifrost_session=${root.session}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			username: "x".repeat(8),
			password: PASSWORD,
			role: "viewer",
		}),
	});
	assert.equal(noCsrf.status, 403);

	// ...but never on a header credential, so existing SDK clients are untouched.
	const withKey = await app.request("/admin/keys", { headers: masterAuth });
	assert.equal(withKey.status, 200);

	/* ---- the root operator creates a viewer ---- */

	const created = await app.request("/admin/users", {
		method: "POST",
		headers: asOperator(root, { "content-type": "application/json" }),
		body: JSON.stringify({
			username: USERNAME,
			password: PASSWORD,
			role: "viewer",
		}),
	});
	assert.equal(created.status, 201);
	const createdBody = (await created.json()) as {
		data: { id: string; role: string; createdBy: string };
	};
	createdUserId = createdBody.data.id;
	assert.equal(createdBody.data.role, "viewer");
	assert.equal(createdBody.data.createdBy, "root");
	assert.equal("passwordHash" in createdBody.data, false);

	/* ---- the viewer reaches read routes and nothing else ---- */

	const viewerLogin = await login(USERNAME, PASSWORD);
	assert.equal(viewerLogin.status, 201);
	const viewer = readCookies(viewerLogin);

	const viewerReads = await app.request("/admin/deployments", {
		headers: asOperator(viewer),
	});
	assert.equal(viewerReads.status, 200);

	for (const [path, method] of [
		["/admin/keys", "GET"],
		["/admin/logs", "GET"],
		["/admin/users", "GET"],
	] as const) {
		const res = await app.request(path, {
			method,
			headers: asOperator(viewer),
		});
		assert.equal(
			res.status,
			403,
			`${method} ${path} must be denied to a viewer`,
		);
	}

	/* ---- disabling the user kills the live session immediately ---- */

	const disabled = await app.request(`/admin/users/${createdUserId}`, {
		method: "PATCH",
		headers: asOperator(root, { "content-type": "application/json" }),
		body: JSON.stringify({ enabled: false }),
	});
	assert.equal(disabled.status, 200);

	const afterDisable = await app.request("/admin/deployments", {
		headers: asOperator(viewer),
	});
	assert.equal(afterDisable.status, 401);

	/* ---- logging out revokes the root session too ---- */

	const loggedOut = await app.request("/auth/session", {
		method: "DELETE",
		headers: asOperator(root),
	});
	assert.equal(loggedOut.status, 204);

	const afterLogout = await app.request("/auth/session", {
		headers: asOperator(root),
	});
	assert.equal(afterLogout.status, 401);
});

test("dashboard auth: a virtual key never reaches /admin", {
	skip,
}, async () => {
	const created = await app.request("/admin/keys", {
		method: "POST",
		headers: { ...masterAuth, "content-type": "application/json" },
		body: JSON.stringify({ name: `itest-scope-${Date.now()}` }),
	});
	assert.equal(created.status, 201);
	const body = (await created.json()) as {
		data: { id: string; key: string; createdBy: string };
	};
	assert.equal(body.data.createdBy, "master-key");

	try {
		const res = await app.request("/admin/keys", {
			headers: { authorization: `Bearer ${body.data.key}` },
		});
		assert.equal(res.status, 403);
	} finally {
		await app.request(`/admin/keys/${body.data.id}`, {
			method: "DELETE",
			headers: masterAuth,
		});
	}
});
