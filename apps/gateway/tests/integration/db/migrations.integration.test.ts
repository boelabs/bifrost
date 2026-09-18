/**
 * Integration (real Postgres) for boot-time migrations.
 *
 * The point of the advisory lock is a race that only happens with a real database: every replica
 * migrates on boot, so several processes can start the same migration at the same moment. Drizzle's
 * migrator does not coordinate — it reads the last applied migration, decides what is pending and
 * applies it — so without the lock the loser fails on a relation that already exists.
 */

import { pgAvailable } from "#test-support/infra.ts";
import { runMigrations } from "#db/migrations.ts";
import assert from "node:assert/strict";
import { sql } from "#db/client.ts";
import { test } from "node:test";

const skip = (await pgAvailable()) ? false : "Postgres unavailable";

test("concurrent migrations serialise instead of racing", {
	skip,
}, async () => {
	// What a rollout to several replicas does: the same work started at the same moment.
	const results = await Promise.allSettled(
		Array.from({ length: 4 }, () => runMigrations()),
	);

	const rejected = results.filter((result) => result.status === "rejected");
	assert.deepEqual(
		rejected.map((result) => String(result.reason)),
		[],
		"no concurrent migration may fail",
	);
});

test("migrations are idempotent once applied", { skip }, async () => {
	await runMigrations();
	const before =
		await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
	await runMigrations();
	const after =
		await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;

	assert.equal(
		after[0]?.n,
		before[0]?.n,
		"a re-run must not re-apply anything",
	);
});

test("the advisory lock is released afterwards", { skip }, async () => {
	await runMigrations();

	// A leaked session lock would block the next replica to boot for as long as the connection
	// lives, which is the whole process — a hang rather than an error, and much harder to read.
	const held = await sql`
		select count(*)::int as n from pg_locks
		where locktype = 'advisory' and objid = 918273645
	`;
	assert.equal(
		held[0]?.n,
		0,
		"the migration lock must not outlive the migration",
	);
});
