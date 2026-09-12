/**
 * Integration (real Redis) for per-virtual-key rate limiting: atomic RPM (Lua) and budget.
 * Runs with `bun run test:integration`. Uses unique ids and cleans their keys.
 */

import { enforceVirtualKey, reserveVirtualKeyUsage } from "#ratelimit/index.ts";
import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import type { VirtualKeyAuth } from "#auth/types.ts";
import { GatewayError } from "#core/errors.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { redis } from "#cache/redis.ts";
import { test } from "node:test";

import {
	addVirtualKeySpend,
	getVirtualKeyById,
	createVirtualKey,
	deleteVirtualKey,
} from "#db/repos/virtualKeys.ts";

const skip = (await redisAvailable()) ? false : "Redis unavailable";
const databaseSkip =
	!skip && (await pgAvailable()) ? false : "Postgres/Redis unavailable";

function key(over: Partial<VirtualKeyAuth>): VirtualKeyAuth {
	return {
		id: randomUUID(),
		name: "test",
		allowedModels: [],
		enabled: true,
		expiresAt: null,
		maxBudgetCents: null,
		budgetReset: null,
		budgetResetAt: null,
		spendCents: 0,
		tpm: null,
		rpm: null,
		...over,
	};
}

test("RPM: allows up to the limit and then throws 429 (atomic check+incr)", {
	skip,
}, async () => {
	const k = key({ rpm: 3 });
	const b = Math.floor(Date.now() / 60_000);
	try {
		await enforceVirtualKey(k);
		await enforceVirtualKey(k);
		await enforceVirtualKey(k); // 3/3 ok
		await assert.rejects(
			() => enforceVirtualKey(k),
			(err) =>
				GatewayError.is(err) &&
				err.class === "rate_limit" &&
				err.code === "rate_limit_exceeded",
		);
	} finally {
		await redis.del(
			`ratelimit:v2:rpm:${k.id}:${b}`,
			`ratelimit:v2:rpm:${k.id}:${b - 1}`,
			`ratelimit:v2:rpm:${k.id}:${b + 1}`,
		);
	}
});

test("Budget: if Redis spend reaches the limit, throws budget_exceeded", {
	skip,
}, async () => {
	const k = key({ maxBudgetCents: 100 });
	try {
		await redis.set(`ratelimit:v2:budget:${k.id}`, "100"); // full budget already spent
		await assert.rejects(
			() => enforceVirtualKey(k),
			(err) =>
				GatewayError.is(err) &&
				err.class === "rate_limit" &&
				err.code === "budget_exceeded",
		);
	} finally {
		await redis.del(`ratelimit:v2:budget:${k.id}`);
	}
});

test("TPM reservations are atomic under concurrency and release capacity", {
	skip,
}, async () => {
	const k = key({ tpm: 100 });
	const b = Math.floor(Date.now() / 60_000);
	try {
		const results = await Promise.allSettled(
			Array.from({ length: 10 }, () => reserveVirtualKeyUsage(k, 40, 0)),
		);
		const accepted = results.filter(
			(
				result,
			): result is PromiseFulfilledResult<
				Awaited<ReturnType<typeof reserveVirtualKeyUsage>>
			> => result.status === "fulfilled",
		);
		assert.equal(accepted.length, 2);
		await Promise.all(accepted.map((result) => result.value.release()));
		const next = await reserveVirtualKeyUsage(k, 100, 0);
		await next.settle(25, 0);
		assert.equal(Number(await redis.get(`ratelimit:v2:tpm:${k.id}:${b}`)), 25);
	} finally {
		await redis.del(
			`ratelimit:v2:tpm:${k.id}:${b}`,
			`ratelimit:v2:tpm-reserved:${k.id}:${b}`,
			`ratelimit:v2:tpm-leases:${k.id}:${b}`,
			`ratelimit:v2:tpm-amounts:${k.id}:${b}`,
		);
	}
});

test("budget reservations reject concurrent oversubscription and recover on release", {
	skip,
}, async () => {
	const k = key({ maxBudgetCents: 100 });
	try {
		await redis.set(`ratelimit:v2:budget:${k.id}`, "0");
		const first = await reserveVirtualKeyUsage(k, 0, 60);
		await assert.rejects(
			() => reserveVirtualKeyUsage(k, 0, 60),
			(error) => GatewayError.is(error) && error.code === "budget_exceeded",
		);
		await first.release();
		const next = await reserveVirtualKeyUsage(k, 0, 100);
		await next.release();
		const zero = await reserveVirtualKeyUsage(k, 0, 0);
		await zero.settle(0, 25);
		assert.equal(Number(await redis.get(`ratelimit:v2:budget:${k.id}`)), 25);
	} finally {
		await redis.del(
			`ratelimit:v2:budget:${k.id}`,
			`ratelimit:v2:budget-reserved:${k.id}`,
			`ratelimit:v2:budget-leases:${k.id}`,
			`ratelimit:v2:budget-amounts:${k.id}`,
		);
	}
});

test("an expired budget resets once before concurrent reservations", {
	skip: databaseSkip,
}, async () => {
	const created = await createVirtualKey({
		name: `budget-reset-${randomUUID()}`,
		maxBudgetCents: 100,
		budgetReset: "hourly",
		budgetResetAt: new Date(Date.now() - 60_000),
	});
	await addVirtualKeySpend(created.row.id, 80);
	const k = key({
		id: created.row.id,
		maxBudgetCents: 100,
		budgetReset: "hourly",
		budgetResetAt: new Date(Date.now() - 60_000).toISOString(),
		spendCents: 80,
	});
	try {
		const results = await Promise.allSettled([
			reserveVirtualKeyUsage(k, 0, 60),
			reserveVirtualKeyUsage(k, 0, 60),
		]);
		const accepted = results.filter(
			(
				result,
			): result is PromiseFulfilledResult<
				Awaited<ReturnType<typeof reserveVirtualKeyUsage>>
			> => result.status === "fulfilled",
		);
		assert.equal(accepted.length, 1);
		await accepted[0]!.value.release();
		const persisted = await getVirtualKeyById(k.id);
		assert.equal(Number(persisted?.spendCents), 0);
		assert.ok((persisted?.budgetResetAt?.getTime() ?? 0) > Date.now());
	} finally {
		await redis.del(
			`ratelimit:v2:budget:${k.id}`,
			`ratelimit:v2:budget-reserved:${k.id}`,
			`ratelimit:v2:budget-leases:${k.id}`,
			`ratelimit:v2:budget-amounts:${k.id}`,
		);
		await deleteVirtualKey(k.id);
	}
});
