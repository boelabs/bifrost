import { permissionsFor, roleHas, DASHBOARD_ROLES } from "./roles.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("the three dangerous capabilities stay owner-only", () => {
	for (const permission of ["extensions:manage", "users:manage"] as const) {
		assert.equal(roleHas("owner", permission), true);
		assert.equal(roleHas("admin", permission), false);
		assert.equal(roleHas("viewer", permission), false);
	}
});

test("a viewer never reads real prompt content, logs, or keys", () => {
	assert.equal(roleHas("viewer", "payloads:read"), false);
	assert.equal(roleHas("viewer", "logs:read"), false);
	assert.equal(roleHas("viewer", "keys:read"), false);
});

test("a viewer has read-only reach and cannot spend on inference", () => {
	const viewer = permissionsFor("viewer");
	assert.ok(viewer.includes("deployments:read"));
	assert.ok(viewer.includes("usage:read"));
	assert.equal(
		viewer.some((permission) => permission.endsWith(":write")),
		false,
	);
	assert.equal(viewer.includes("inference:use"), false);
});

test("the roles nest, so each one strictly contains the previous", () => {
	const viewer = permissionsFor("viewer");
	const admin = permissionsFor("admin");
	const owner = permissionsFor("owner");
	assert.ok(viewer.every((permission) => admin.includes(permission)));
	assert.ok(admin.every((permission) => owner.includes(permission)));
	assert.ok(owner.length > admin.length);
	assert.ok(admin.length > viewer.length);
});

test("exactly three roles are declared", () => {
	assert.deepEqual([...DASHBOARD_ROLES], ["owner", "admin", "viewer"]);
});
