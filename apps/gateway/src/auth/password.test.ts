import assert from "node:assert/strict";
import { test } from "node:test";

import {
	verifyRootPassword,
	verifyPassword,
	generateToken,
	hashPassword,
} from "./password.ts";

test("hashing verifies the right password and rejects the wrong one", async () => {
	const digest = await hashPassword("correct horse battery staple");
	assert.equal(
		await verifyPassword("correct horse battery staple", digest),
		true,
	);
	assert.equal(
		await verifyPassword("Correct horse battery staple", digest),
		false,
	);
});

test("hashing is salted, so one password never yields one digest", async () => {
	const a = await hashPassword("the same password");
	const b = await hashPassword("the same password");
	assert.notEqual(a, b);
	assert.equal(await verifyPassword("the same password", a), true);
	assert.equal(await verifyPassword("the same password", b), true);
});

test("hashing uses argon2id", async () => {
	assert.ok((await hashPassword("whatever")).startsWith("$argon2id$"));
});

test("a corrupted digest returns false instead of throwing", async () => {
	assert.equal(await verifyPassword("whatever", "not-a-digest"), false);
	assert.equal(await verifyPassword("whatever", ""), false);
});

test("the root password comparison accepts only an exact match", () => {
	assert.equal(
		verifyRootPassword("s3cret-root-value", "s3cret-root-value"),
		true,
	);
	assert.equal(
		verifyRootPassword("s3cret-root-valuE", "s3cret-root-value"),
		false,
	);
	assert.equal(verifyRootPassword("", "s3cret-root-value"), false);
	assert.equal(
		verifyRootPassword("s3cret-root-value-longer", "s3cret-root-value"),
		false,
	);
});

test("session tokens are url-safe and carry 256 bits of entropy", () => {
	const token = generateToken();
	assert.match(token, /^[A-Za-z0-9_-]+$/);
	assert.equal(Buffer.from(token, "base64url").length, 32);
	const tokens = new Set(Array.from({ length: 200 }, generateToken));
	assert.equal(tokens.size, 200);
});
