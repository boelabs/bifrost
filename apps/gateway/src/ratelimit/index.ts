import { periodSeconds, secondsUntilReset } from "./period.ts";
import type { VirtualKeyAuth } from "#auth/types.ts";
import { GatewayError } from "#core/errors.ts";
import { randomUUID } from "node:crypto";
import { redis } from "#cache/redis.ts";

import {
	resetVirtualKeySpendIfDue,
	addVirtualKeySpend,
	getVirtualKeyById,
} from "#db/repos/virtualKeys.ts";

/**
 * Rate limiting (TPM/RPM) and budgets per virtual key, with atomic state in Redis.
 * - RPM: per-minute window, atomic check+incr (Lua).
 * - TPM: conservative per-request reservations reconciled to actual usage at settlement.
 * - Budget: conservative cost reservations reconciled to actual spend at settlement.
 * MODEL limits (rpmLimit/tpmLimit) are applied by the router when choosing a deployment.
 */

function minuteBucket(): number {
	return Math.floor(Date.now() / 60_000);
}

// Lua: check + incr (RPM). Returns -1 if it would exceed the limit, or the new value.
const RPM_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur + 1 > tonumber(ARGV[1]) then return -1 end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 120)
return cur + 1
`;

// Atomic expiring reservation for one numeric counter. Expired leases are reclaimed before each
// admission, so a crashed replica cannot strand capacity until a monthly budget reset.
const RESERVE_LUA = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', ARGV[1], 'LIMIT', 0, 256)
for _, id in ipairs(expired) do
  local amount = tonumber(redis.call('HGET', KEYS[4], id) or '0')
  if amount > 0 then redis.call('INCRBYFLOAT', KEYS[2], -amount) end
  redis.call('HDEL', KEYS[4], id)
  redis.call('ZREM', KEYS[3], id)
end

local actual = tonumber(redis.call('GET', KEYS[1]) or '0')
local reserved = math.max(0, tonumber(redis.call('GET', KEYS[2]) or '0'))
if #expired > 0 then
  if reserved == 0 then
    redis.call('DEL', KEYS[2])
  else
    redis.call('SET', KEYS[2], tostring(reserved), 'EX', ARGV[6])
  end
end
local amount = tonumber(ARGV[3])
if actual + reserved + amount > tonumber(ARGV[2]) then
  return {0, tostring(actual), tostring(reserved)}
end
redis.call('INCRBYFLOAT', KEYS[2], amount)
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[5])
redis.call('HSET', KEYS[4], ARGV[5], ARGV[3])
for i = 2, 4 do redis.call('EXPIRE', KEYS[i], ARGV[6]) end
return {1, tostring(actual), tostring(reserved + amount)}
`;

const SETTLE_LUA = `
local raw_reserved = redis.call('HGET', KEYS[4], ARGV[1])
if not raw_reserved then return redis.call('GET', KEYS[1]) or '0' end
local reserved = tonumber(raw_reserved) or 0
redis.call('HDEL', KEYS[4], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
local remaining = math.max(0, tonumber(redis.call('GET', KEYS[2]) or '0') - reserved)
redis.call('SET', KEYS[2], tostring(remaining), 'EX', ARGV[3])
local actual = tonumber(ARGV[2])
if actual > 0 then
  redis.call('INCRBYFLOAT', KEYS[1], actual)
  if tonumber(ARGV[4]) > 0 then redis.call('EXPIRE', KEYS[1], ARGV[4]) end
end
return redis.call('GET', KEYS[1]) or '0'
`;

const KEY_PREFIX = "ratelimit:v2";
const kRpm = (id: string, b: number) => `${KEY_PREFIX}:rpm:${id}:${b}`;
const kTpm = (id: string, b: number) => `${KEY_PREFIX}:tpm:${id}:${b}`;
const kTpmReserved = (id: string, b: number) =>
	`${KEY_PREFIX}:tpm-reserved:${id}:${b}`;
const kTpmLeases = (id: string, b: number) =>
	`${KEY_PREFIX}:tpm-leases:${id}:${b}`;
const kTpmAmounts = (id: string, b: number) =>
	`${KEY_PREFIX}:tpm-amounts:${id}:${b}`;
const kBudget = (id: string) => `${KEY_PREFIX}:budget:${id}`;
const kBudgetReserved = (id: string) => `${KEY_PREFIX}:budget-reserved:${id}`;
const kBudgetLeases = (id: string) => `${KEY_PREFIX}:budget-leases:${id}`;
const kBudgetAmounts = (id: string) => `${KEY_PREFIX}:budget-amounts:${id}`;

const LEASE_TTL_SECONDS = 2 * 60 * 60;
const LEASE_TTL_MS = LEASE_TTL_SECONDS * 1000;

export async function clearVirtualKeyBudget(id: string): Promise<void> {
	await redis.del(
		kBudget(id),
		kBudgetReserved(id),
		kBudgetLeases(id),
		kBudgetAmounts(id),
	);
}

export interface RateLimitSnapshot {
	headers: Record<string, string>;
}

function minuteResetSeconds(): number {
	return 60 - (Math.floor(Date.now() / 1000) % 60);
}

function withHeader(
	headers: Record<string, string>,
	name: string,
	value: number | string | null | undefined,
): void {
	if (value === null || value === undefined) return;
	headers[name] = String(value);
}

function makeHeaders(p: {
	key: VirtualKeyAuth;
	rpmUsed?: number;
	tpmUsed?: number;
	budgetUsed?: number;
	budgetResetSeconds?: number;
}): Record<string, string> {
	const headers: Record<string, string> = {};
	const reset = minuteResetSeconds();
	if (p.key.rpm != null) {
		withHeader(headers, "x-ratelimit-limit-requests", p.key.rpm);
		withHeader(
			headers,
			"x-ratelimit-remaining-requests",
			Math.max(0, p.key.rpm - (p.rpmUsed ?? 0)),
		);
		withHeader(headers, "x-ratelimit-reset-requests", reset);
	}
	if (p.key.tpm != null) {
		withHeader(headers, "x-ratelimit-limit-tokens", p.key.tpm);
		withHeader(
			headers,
			"x-ratelimit-remaining-tokens",
			Math.max(0, p.key.tpm - (p.tpmUsed ?? 0)),
		);
		withHeader(headers, "x-ratelimit-reset-tokens", reset);
	}
	if (p.key.maxBudgetCents != null) {
		withHeader(headers, "x-ratelimit-limit-budget-cents", p.key.maxBudgetCents);
		withHeader(
			headers,
			"x-ratelimit-remaining-budget-cents",
			Math.max(0, p.key.maxBudgetCents - (p.budgetUsed ?? 0)).toFixed(10),
		);
		withHeader(
			headers,
			"x-ratelimit-reset-budget",
			p.budgetResetSeconds ?? secondsUntilReset(p.key),
		);
	}
	return headers;
}

function makeHeaderArgs(
	key: VirtualKeyAuth,
	values: {
		rpmUsed?: number | undefined;
		tpmUsed?: number | undefined;
		budgetUsed?: number | undefined;
		budgetResetSeconds?: number | undefined;
	},
): Parameters<typeof makeHeaders>[0] {
	const args: Parameters<typeof makeHeaders>[0] = { key };
	if (values.rpmUsed !== undefined) args.rpmUsed = values.rpmUsed;
	if (values.tpmUsed !== undefined) args.tpmUsed = values.tpmUsed;
	if (values.budgetUsed !== undefined) args.budgetUsed = values.budgetUsed;
	if (values.budgetResetSeconds !== undefined)
		args.budgetResetSeconds = values.budgetResetSeconds;
	return args;
}

interface BudgetState {
	spend: number;
	ttlSeconds: number;
}

function finiteNonNegative(value: number, name: string): number {
	if (!Number.isFinite(value) || value < 0)
		throw new Error(`${name} must be a finite non-negative number`);
	return value;
}

function redisCounter(raw: string | null, name: string): number {
	const value = Number(raw ?? 0);
	if (!Number.isFinite(value) || value < 0)
		throw new Error(`Redis contains an invalid ${name} counter`);
	return value;
}

async function budgetSpendFromRedisOrDb(
	key: VirtualKeyAuth,
): Promise<BudgetState> {
	const actualKey = kBudget(key.id);
	const [raw, redisTtl] = await Promise.all([
		redis.get(actualKey),
		redis.ttl(actualKey),
	]);
	if (raw !== null) {
		return {
			spend: redisCounter(raw, "budget"),
			ttlSeconds: redisTtl > 0 ? redisTtl : secondsUntilReset(key),
		};
	}

	// Redis can be flushed or evict a key. Seed from the authoritative row rather than the cached
	// authentication projection, and advance an expired reset window synchronously before admitting
	// new spend. The conditional SQL update makes this exact-once across replicas.
	const persisted = await getVirtualKeyById(key.id);
	if (!persisted)
		throw new GatewayError({
			class: "auth",
			code: "invalid_api_key",
			message: "Virtual API key no longer exists",
		});
	const resetAt = persisted.budgetResetAt?.getTime() ?? null;
	if (
		persisted.budgetReset !== null &&
		resetAt !== null &&
		resetAt <= Date.now()
	) {
		const reset = await resetVirtualKeySpendIfDue(
			key.id,
			persisted.budgetReset,
		);
		if (!reset) return budgetSpendFromRedisOrDb(key);
		const ttlSeconds = periodSeconds(persisted.budgetReset);
		await redis.set(actualKey, "0", "EX", ttlSeconds, "NX");
		const seeded = await redis.get(actualKey);
		return {
			spend: redisCounter(seeded, "budget"),
			ttlSeconds,
		};
	}

	const spend = finiteNonNegative(
		Number(persisted.spendCents),
		"Persisted spend",
	);
	const ttlSeconds = secondsUntilReset({
		budgetReset: persisted.budgetReset,
		budgetResetAt: persisted.budgetResetAt?.toISOString() ?? null,
	});
	if (ttlSeconds > 0)
		await redis.set(actualKey, String(spend), "EX", ttlSeconds, "NX");
	else await redis.set(actualKey, String(spend), "NX");
	const seeded = await redis.get(actualKey);
	return {
		spend: redisCounter(seeded ?? String(spend), "budget"),
		ttlSeconds,
	};
}

/**
 * Applies the virtual key RPM, TPM, and budget BEFORE calling upstream.
 * Throws GatewayError(rate_limit, 429) if any limit is exceeded.
 */
export async function enforceVirtualKey(
	key: VirtualKeyAuth,
): Promise<RateLimitSnapshot> {
	const b = minuteBucket();
	let rpmUsed: number | undefined;
	let tpmUsed: number | undefined;
	let budgetUsed: number | undefined;
	let budgetResetSeconds: number | undefined;

	if (key.rpm != null) {
		const res = (await redis.eval(
			RPM_LUA,
			1,
			kRpm(key.id, b),
			String(key.rpm),
		)) as number;
		rpmUsed = res;
		if (res === -1) {
			throw new GatewayError({
				class: "rate_limit",
				message: `RPM limit exceeded (${key.rpm}/min) for this API key`,
				code: "rate_limit_exceeded",
				headers: makeHeaders(
					makeHeaderArgs(key, { rpmUsed: key.rpm, tpmUsed, budgetUsed }),
				),
			});
		}
	}

	if (key.tpm != null) {
		// This cheap preflight rejects an already exhausted key. The authoritative atomic reservation
		// happens after the payload and deployment-specific output bound are known.
		const cur = redisCounter(await redis.get(kTpm(key.id, b)), "TPM");
		tpmUsed = cur;
		if (cur >= key.tpm) {
			throw new GatewayError({
				class: "rate_limit",
				message: `TPM limit exceeded (${key.tpm}/min) for this API key`,
				code: "rate_limit_exceeded",
				headers: makeHeaders(
					makeHeaderArgs(key, { rpmUsed, tpmUsed: key.tpm, budgetUsed }),
				),
			});
		}
	}

	if (key.maxBudgetCents != null) {
		const budget = await budgetSpendFromRedisOrDb(key);
		budgetUsed = budget.spend;
		budgetResetSeconds = budget.ttlSeconds;
		if (budget.spend >= key.maxBudgetCents) {
			throw new GatewayError({
				class: "rate_limit",
				message: `Budget exhausted for this API key (limit ${key.maxBudgetCents} cents)`,
				code: "budget_exceeded",
				headers: makeHeaders(
					makeHeaderArgs(key, {
						rpmUsed,
						tpmUsed,
						budgetUsed: key.maxBudgetCents,
						budgetResetSeconds,
					}),
				),
			});
		}
	}

	return {
		headers: makeHeaders(
			makeHeaderArgs(key, {
				rpmUsed,
				tpmUsed,
				budgetUsed,
				budgetResetSeconds,
			}),
		),
	};
}

interface CounterLease {
	actualKey: string;
	reservedKey: string;
	leasesKey: string;
	amountsKey: string;
	id: string;
	leaseTtlSeconds: number;
	actualTtlSeconds: number;
}

function evalArray(value: unknown): readonly unknown[] {
	if (!Array.isArray(value))
		throw new Error("Redis returned an invalid reservation result");
	return value;
}

async function reserveCounter(options: {
	actualKey: string;
	reservedKey: string;
	leasesKey: string;
	amountsKey: string;
	limit: number;
	amount: number;
	leaseTtlSeconds: number;
	actualTtlSeconds: number;
}): Promise<{ accepted: boolean; lease: CounterLease }> {
	const id = randomUUID();
	if (!Number.isFinite(options.limit) || options.limit < 0)
		throw new Error("Reservation limit must be a finite non-negative number");
	const amount = finiteNonNegative(options.amount, "Reservation amount");
	const result = evalArray(
		await redis.eval(
			RESERVE_LUA,
			4,
			options.actualKey,
			options.reservedKey,
			options.leasesKey,
			options.amountsKey,
			String(Date.now()),
			String(options.limit),
			String(amount),
			String(Date.now() + LEASE_TTL_MS),
			id,
			String(options.leaseTtlSeconds),
		),
	);
	return {
		accepted: Number(result[0]) === 1,
		lease: {
			actualKey: options.actualKey,
			reservedKey: options.reservedKey,
			leasesKey: options.leasesKey,
			amountsKey: options.amountsKey,
			id,
			leaseTtlSeconds: options.leaseTtlSeconds,
			actualTtlSeconds: options.actualTtlSeconds,
		},
	};
}

async function settleCounter(
	lease: CounterLease,
	actual: number,
): Promise<void> {
	const settledActual = finiteNonNegative(actual, "Settled usage");
	await redis.eval(
		SETTLE_LUA,
		4,
		lease.actualKey,
		lease.reservedKey,
		lease.leasesKey,
		lease.amountsKey,
		lease.id,
		String(settledActual),
		String(lease.leaseTtlSeconds),
		String(lease.actualTtlSeconds),
	);
}

export interface VirtualKeyUsageLease {
	settle(totalTokens: number, costCents: number): Promise<void>;
	release(): Promise<void>;
}

/** Atomically reserves the conservative token/cost upper bounds for one routed attempt. */
export async function reserveVirtualKeyUsage(
	key: VirtualKeyAuth,
	reservedTokens: number,
	reservedCostCents: number,
): Promise<VirtualKeyUsageLease> {
	const leases: CounterLease[] = [];
	const b = minuteBucket();
	if (key.tpm != null) {
		const reservation = await reserveCounter({
			actualKey: kTpm(key.id, b),
			reservedKey: kTpmReserved(key.id, b),
			leasesKey: kTpmLeases(key.id, b),
			amountsKey: kTpmAmounts(key.id, b),
			limit: key.tpm,
			amount: reservedTokens,
			leaseTtlSeconds: LEASE_TTL_SECONDS,
			actualTtlSeconds: 120,
		});
		if (!reservation.accepted) {
			throw new GatewayError({
				class: "rate_limit",
				code: "rate_limit_exceeded",
				message: `TPM limit exceeded (${key.tpm}/min) for this API key`,
			});
		}
		leases.push(reservation.lease);
	}
	if (key.maxBudgetCents != null) {
		const budget = await budgetSpendFromRedisOrDb(key);
		const actualTtlSeconds = budget.ttlSeconds;
		const leaseTtlSeconds =
			actualTtlSeconds > 0
				? Math.min(actualTtlSeconds, LEASE_TTL_SECONDS)
				: LEASE_TTL_SECONDS;
		const reservation = await reserveCounter({
			actualKey: kBudget(key.id),
			reservedKey: kBudgetReserved(key.id),
			leasesKey: kBudgetLeases(key.id),
			amountsKey: kBudgetAmounts(key.id),
			limit: key.maxBudgetCents,
			amount: reservedCostCents,
			leaseTtlSeconds,
			actualTtlSeconds,
		});
		if (!reservation.accepted) {
			await Promise.all(leases.map((lease) => settleCounter(lease, 0)));
			throw new GatewayError({
				class: "rate_limit",
				code: "budget_exceeded",
				message: `Budget would be exceeded for this API key (limit ${key.maxBudgetCents} cents)`,
			});
		}
		leases.push(reservation.lease);
	}

	let settled = false;
	return {
		settle: async (totalTokens, costCents) => {
			if (settled) return;
			settled = true;
			const operations = leases.map((lease, index) =>
				settleCounter(
					lease,
					index === 0 && key.tpm != null ? totalTokens : costCents,
				),
			);
			if (costCents > 0) operations.push(addVirtualKeySpend(key.id, costCents));
			await Promise.all(operations);
		},
		release: async () => {
			if (settled) return;
			settled = true;
			await Promise.all(leases.map((lease) => settleCounter(lease, 0)));
		},
	};
}
