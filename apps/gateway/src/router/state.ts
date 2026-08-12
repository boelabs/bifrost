import { EXECUTION_POLICY_MAX_TOTAL_MS } from "#core/executionPolicy.ts";
import { releaseCircuitPermit, closeCircuits } from "./circuit.ts";
import type { CircuitPermit } from "./circuit.ts";
import { randomUUID } from "node:crypto";
import { redis } from "#cache/redis.ts";

/**
 * Router state in Redis. Keys per model (deployment):
 *   rt:v2:inflight:{id}     derived counter of live in-flight leases (least-busy)
 *   rt:rpm:{id}:{minute}    requests in the current minute
 *   rt:tpm:{id}:{minute}    tokens in the current minute
 *   rt:successes:{id}       recent successful completions
 *   rt:failures:{id}        recent failed upstream attempts
 *   rt:latency_ms:{id}      EWMA of successful completion latency
 *   rt:throughput_tps:{id}  EWMA of output tokens/second
 *
 * Circuit state uses its own atomic implementation in circuit.ts.
 */

// Longer than every configurable execution policy. Each attempt owns a lease, so crashed replicas
// self-heal even while healthy traffic keeps refreshing other attempts for the same deployment.
const INFLIGHT_TTL = Math.ceil(EXECUTION_POLICY_MAX_TOTAL_MS / 1000) + 300;
const WINDOW_TTL = 120; // s - RPM/TPM expire on their own
const HEALTH_TTL = 600; // s - rolling success/failure and performance memory
const EWMA_ALPHA = 0.2;

export interface DeploymentMetrics {
	inflight: number;
	rpm: number;
	tpm: number;
	successes: number;
	failures: number;
	latencyMs: number | null;
	throughputTps: number | null;
	healthScore: number;
}

export interface SuccessTelemetry {
	totalTokens: number | null;
	completionTokens: number | null;
	durationMs: number;
}

/** Detail of the error that put a deployment into cooldown. Raw provider data is never persisted. */
export interface CooldownCause {
	class: string;
	message: string;
	status?: number;
	/** Stable correlation value for the original message/body, without retaining either one. */
	fingerprint?: string;
	/** Accepted only as transient input to the circuit serializer; never stored in Redis. */
	body?: unknown;
}

function minuteBucket(): number {
	return Math.floor(Date.now() / 60_000);
}

const kInflight = (id: string) => `rt:v2:inflight:${id}`;
const kInflightLeases = (id: string) => `rt:v2:inflight-leases:${id}`;
const kRpm = (id: string, b: number) => `rt:rpm:${id}:${b}`;
const kTpm = (id: string, b: number) => `rt:tpm:${id}:${b}`;
const kReservedTpm = (id: string, b: number) => `rt:tpm-reserved:${id}:${b}`;
const kSuccesses = (id: string) => `rt:successes:${id}`;
const kFailures = (id: string) => `rt:failures:${id}`;
const kLatencyMs = (id: string) => `rt:latency_ms:${id}`;
const kThroughputTps = (id: string) => `rt:throughput_tps:${id}`;

const START_ATTEMPT_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', ARGV[4])
local inflight = redis.call('ZCARD', KEYS[5])
if inflight == 0 then
  redis.call('DEL', KEYS[1])
else
  redis.call('SET', KEYS[1], inflight, 'EX', ARGV[7])
end
local rpm = tonumber(redis.call('GET', KEYS[2]) or '0')
local tpm = tonumber(redis.call('GET', KEYS[3]) or '0')
local reserved = tonumber(redis.call('GET', KEYS[4]) or '0')
local rpm_limit = tonumber(ARGV[1])
local tpm_limit = tonumber(ARGV[2])
local token_reservation = tonumber(ARGV[3])
if rpm_limit >= 0 and rpm + 1 > rpm_limit then return {0, 1} end
if tpm_limit >= 0 and tpm + reserved + token_reservation > tpm_limit then return {0, 2} end
redis.call('ZADD', KEYS[5], ARGV[5], ARGV[6])
redis.call('EXPIRE', KEYS[5], ARGV[7])
redis.call('SET', KEYS[1], inflight + 1, 'EX', ARGV[7])
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[8])
if token_reservation > 0 then
  redis.call('INCRBY', KEYS[4], token_reservation)
  redis.call('EXPIRE', KEYS[4], ARGV[8])
end
return {1, 0}
`;

const SETTLE_ATTEMPT_LUA = `
local removed = redis.call('ZREM', KEYS[4], ARGV[1])
local inflight = redis.call('ZCARD', KEYS[4])
if removed == 0 then return {0, inflight} end
if inflight == 0 then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[4])
else
	redis.call('SET', KEYS[1], inflight, 'EX', ARGV[4])
end
local token_reservation = tonumber(ARGV[2])
if token_reservation > 0 then
  local reserved = math.max(0, tonumber(redis.call('GET', KEYS[3]) or '0') - token_reservation)
  if reserved == 0 then
    redis.call('DEL', KEYS[3])
  else
    redis.call('SET', KEYS[3], reserved, 'EX', ARGV[5])
  end
end
local actual_tokens = tonumber(ARGV[3])
if actual_tokens > 0 then
  redis.call('INCRBY', KEYS[2], actual_tokens)
	redis.call('EXPIRE', KEYS[2], ARGV[5])
end
return {1, inflight}
`;

export interface AttemptLease {
	id: string;
	reservedTokens: number;
	bucket: number;
}

export type AttemptAdmission =
	| { accepted: true; lease: AttemptLease }
	| { accepted: false; reason: "rpm" | "tpm" };

export interface AttemptLimits {
	rpmLimit: number | null;
	tpmLimit: number | null;
	reservedTokens: number;
}

function positiveInteger(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return 0;
	return Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(value));
}

/** Atomically checks deployment limits and reserves inflight/RPM/TPM capacity. */
export async function onAttemptStart(
	id: string,
	limits: AttemptLimits = {
		rpmLimit: null,
		tpmLimit: null,
		reservedTokens: 0,
	},
): Promise<AttemptAdmission> {
	const b = minuteBucket();
	const leaseId = randomUUID();
	const reservedTokens = positiveInteger(limits.reservedTokens);
	const raw: unknown = await redis.eval(
		START_ATTEMPT_LUA,
		5,
		kInflight(id),
		kRpm(id, b),
		kTpm(id, b),
		kReservedTpm(id, b),
		kInflightLeases(id),
		String(limits.rpmLimit ?? -1),
		String(limits.tpmLimit ?? -1),
		String(reservedTokens),
		String(Date.now()),
		String(Date.now() + INFLIGHT_TTL * 1000),
		leaseId,
		String(INFLIGHT_TTL),
		String(WINDOW_TTL),
	);
	if (!Array.isArray(raw) || raw.length < 2)
		throw new Error("Redis returned an invalid deployment admission result");
	if (Number(raw[0]) === 1)
		return {
			accepted: true,
			lease: { id: leaseId, reservedTokens, bucket: b },
		};
	return { accepted: false, reason: Number(raw[1]) === 1 ? "rpm" : "tpm" };
}

async function settleAttempt(
	id: string,
	lease: AttemptLease,
	actualTokens: number,
): Promise<boolean> {
	const raw: unknown = await redis.eval(
		SETTLE_ATTEMPT_LUA,
		4,
		kInflight(id),
		kTpm(id, lease.bucket),
		kReservedTpm(id, lease.bucket),
		kInflightLeases(id),
		lease.id,
		String(lease.reservedTokens),
		String(positiveInteger(actualTokens)),
		String(INFLIGHT_TTL),
		String(WINDOW_TTL),
	);
	if (!Array.isArray(raw) || raw.length < 2)
		throw new Error("Redis returned an invalid deployment settlement result");
	return Number(raw[0]) === 1;
}

/**
 * Finishes a failed attempt. Throttling and request/gateway failures release inflight without
 * lowering health; transient/configuration failures contribute to health-aware routing.
 */
export async function onAttemptFailure(
	id: string,
	penalizeHealth: boolean,
	lease: AttemptLease,
): Promise<void> {
	const settled = await settleAttempt(id, lease, 0);
	if (!settled) return;
	if (!penalizeHealth) return;
	await redis
		.pipeline()
		.incr(kFailures(id))
		.expire(kFailures(id), HEALTH_TTL)
		.exec();
}

/** Client cancellation: releases the inflight slot WITHOUT penalizing (no fails, no cooldown). */
export async function onAttemptCancel(
	id: string,
	permit: CircuitPermit | undefined,
	lease: AttemptLease,
): Promise<void> {
	await settleAttempt(id, lease, 0);
	if (permit) await releaseCircuitPermit(permit);
}

/** Gateway-local post-processing failure: neutral health, but retain any upstream token usage. */
export async function onAttemptGatewayFinish(
	id: string,
	actualTokens: number,
	permit: CircuitPermit | undefined,
	lease: AttemptLease,
): Promise<void> {
	await settleAttempt(id, lease, actualTokens);
	if (permit) await releaseCircuitPermit(permit);
}

function ewma(previous: string | null, sample: number): number {
	const old = previous === null ? NaN : Number(previous);
	return Number.isFinite(old)
		? old * (1 - EWMA_ALPHA) + sample * EWMA_ALPHA
		: sample;
}

/** Success: updates telemetry, closes owned probes, and resets closed-circuit failure counters. */
export async function onSuccessFinish(
	id: string,
	telemetry: SuccessTelemetry,
	permit: CircuitPermit | undefined,
	lease: AttemptLease,
): Promise<void> {
	const settled = await settleAttempt(id, lease, telemetry.totalTokens ?? 0);
	if (!settled) return;
	const [oldLatency = null, oldThroughput = null] = await redis.mget(
		kLatencyMs(id),
		kThroughputTps(id),
	);
	const latencyMs =
		telemetry.durationMs > 0 ? ewma(oldLatency, telemetry.durationMs) : null;
	const throughputTps =
		telemetry.completionTokens !== null &&
		telemetry.completionTokens > 0 &&
		telemetry.durationMs > 0
			? ewma(
					oldThroughput,
					telemetry.completionTokens / (telemetry.durationMs / 1000),
				)
			: null;

	const pipe = redis
		.pipeline()
		.incr(kSuccesses(id))
		.expire(kSuccesses(id), HEALTH_TTL);
	if (latencyMs !== null)
		pipe.set(kLatencyMs(id), String(latencyMs), "EX", HEALTH_TTL);
	if (throughputTps !== null)
		pipe.set(kThroughputTps(id), String(throughputTps), "EX", HEALTH_TTL);
	await pipe.exec();
	if (permit) await closeCircuits(permit);
}

/** Current metrics (inflight/rpm/tpm) of several deployments. */
// Must match the number of pipe.get() calls pushed per id below (inflight, rpm, tpm, successes,
// failures, latency, throughput) - the read side indexes into `res` using this stride.
const FIELDS_PER_DEPLOYMENT = 7;

/**
 * `healthScore` for a deployment with no recorded attempts in the HEALTH_TTL window defaults to a
 * neutral 0.5 rather than a perfect 1.0. A perfect default would let `health-aware` routing blindly
 * resend full traffic to a deployment that was failing minutes ago: it gets routed away from (so it
 * stops accumulating attempts), its success/failure counters then expire from inactivity, and a
 * "perfect" default would make it look as good as a proven-healthy deployment again with zero new
 * evidence. A neutral default keeps it ranked behind any deployment with an actual track record.
 */
const NEUTRAL_HEALTH_SCORE = 0.5;

export async function fetchMetrics(
	ids: string[],
): Promise<Map<string, DeploymentMetrics>> {
	const map = new Map<string, DeploymentMetrics>();
	if (ids.length === 0) return map;
	const b = minuteBucket();
	const pipe = redis.pipeline();
	for (const id of ids) {
		pipe.get(kInflight(id));
		pipe.get(kRpm(id, b));
		pipe.get(kTpm(id, b));
		pipe.get(kSuccesses(id));
		pipe.get(kFailures(id));
		pipe.get(kLatencyMs(id));
		pipe.get(kThroughputTps(id));
	}
	const res = await pipe.exec();
	ids.forEach((id, i) => {
		const base = i * FIELDS_PER_DEPLOYMENT;
		const successes = Number(res?.[base + 3]?.[1] ?? 0);
		const failures = Number(res?.[base + 4]?.[1] ?? 0);
		const latency = res?.[base + 5]?.[1];
		const throughput = res?.[base + 6]?.[1];
		const total = successes + failures;
		map.set(id, {
			inflight: Number(res?.[base]?.[1] ?? 0),
			rpm: Number(res?.[base + 1]?.[1] ?? 0),
			tpm: Number(res?.[base + 2]?.[1] ?? 0),
			successes,
			failures,
			latencyMs: typeof latency === "string" ? Number(latency) : null,
			throughputTps: typeof throughput === "string" ? Number(throughput) : null,
			healthScore: total > 0 ? successes / total : NEUTRAL_HEALTH_SCORE,
		});
	});
	return map;
}
