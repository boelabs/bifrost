import { createHash, randomUUID } from "node:crypto";
import type { CooldownCause } from "./state.ts";
import { redis } from "#cache/redis.ts";

export interface CircuitSubject {
	kind: "deployment" | "capacity";
	id: string;
}

export interface CircuitSettings {
	enabled: boolean;
	allowedFails: number;
	failureWindowMs: number;
	baseCooldownMs: number;
	maxCooldownMs: number;
	probeTtlMs: number;
}

export type PermitMode = "closed" | "half_open";

export interface CircuitPermit {
	token: string;
	deployment: CircuitSubject;
	capacity: CircuitSubject;
	deploymentMode: PermitMode;
	capacityMode: PermitMode;
}

export type PermitResult =
	| { allowed: true; permit: CircuitPermit }
	| {
			allowed: false;
			blockedBy: "deployment" | "capacity";
			retryAfterMs: number;
	  };

export interface CircuitSnapshot {
	status: "available" | "cooldown" | "half_open" | "rate_limited";
	retryAfterMs: number | null;
	/** Internal routing hint when a half-open probe is already owned. */
	blockedBy?: "deployment" | "capacity";
}

const HISTORY_TTL_MS = 86_400_000;

const ACQUIRE_SCRIPT = `
local token = ARGV[1]
local probe_ttl = tonumber(ARGV[2])

local function acquire(cooldown, history, probe)
  if redis.call("EXISTS", cooldown) == 1 then
    return { -1, redis.call("PTTL", cooldown) }
  end
  if redis.call("EXISTS", history) == 1 then
    local acquired = redis.call("SET", probe, token, "PX", probe_ttl, "NX")
    if acquired then return { 1, probe_ttl } end
    return { -1, redis.call("PTTL", probe) }
  end
  return { 0, 0 }
end

local deployment = acquire(KEYS[1], KEYS[2], KEYS[3])
if deployment[1] == -1 then return { 0, 1, deployment[2] } end

local capacity = acquire(KEYS[4], KEYS[5], KEYS[6])
if capacity[1] == -1 then
  if deployment[1] == 1 and redis.call("GET", KEYS[3]) == token then
    redis.call("DEL", KEYS[3])
  end
  return { 0, 2, capacity[2] }
end

return { 1, deployment[1], capacity[1] }
`;

const RECORD_FAILURE_SCRIPT = `
local mode = ARGV[1]
local allowed_fails = tonumber(ARGV[2])
local window_ms = tonumber(ARGV[3])
local base_ms = tonumber(ARGV[4])
local max_ms = tonumber(ARGV[5])
local history_ttl = tonumber(ARGV[6])
local cause = ARGV[7]
local token = ARGV[8]
local jitter = tonumber(ARGV[9])

if redis.call("EXISTS", KEYS[1]) == 1 then
  return { 0, redis.call("PTTL", KEYS[1]) }
end

local open_count = 1
if mode == "threshold" then
  if redis.call("EXISTS", KEYS[4]) == 1 then return { 0, 0 } end
  local failures = redis.call("INCR", KEYS[3])
  if failures == 1 then redis.call("PEXPIRE", KEYS[3], window_ms) end
  if failures <= allowed_fails then return { 0, redis.call("PTTL", KEYS[3]) } end
  redis.call("SET", KEYS[4], "1", "PX", history_ttl)
elseif mode == "half_open" then
  if redis.call("GET", KEYS[5]) ~= token then return { 0, 0 } end
  open_count = tonumber(redis.call("INCR", KEYS[4]))
  redis.call("PEXPIRE", KEYS[4], history_ttl)
else
  local existing = redis.call("GET", KEYS[4])
  if existing then
    return { 0, 0 }
  end
  redis.call("SET", KEYS[4], "1", "PX", history_ttl)
end

local exponential = base_ms * (2 ^ (open_count - 1))
local duration = math.floor(math.min(max_ms, exponential) * jitter)
duration = math.max(1, math.min(max_ms, duration))
redis.call("SET", KEYS[1], tostring(open_count), "PX", duration)
redis.call("SET", KEYS[2], cause, "PX", duration)
redis.call("DEL", KEYS[3])
if mode == "half_open" and redis.call("GET", KEYS[5]) == token then
  redis.call("DEL", KEYS[5])
end
return { 1, duration }
`;

const CLOSE_SCRIPT = `
local token = ARGV[1]
if redis.call("GET", KEYS[5]) ~= token then return 0 end
redis.call("DEL", KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5])
return 1
`;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function subjectPrefix(subject: CircuitSubject): string {
	return `rt:circuit:${subject.kind}:${subject.id}`;
}

function keys(subject: CircuitSubject): {
	cooldown: string;
	cause: string;
	failures: string;
	history: string;
	probe: string;
} {
	const prefix = subjectPrefix(subject);
	return {
		cooldown: `${prefix}:cooldown`,
		cause: `${prefix}:cause`,
		failures: `${prefix}:failures`,
		history: `${prefix}:history`,
		probe: `${prefix}:probe`,
	};
}

export function deploymentSubject(id: string): CircuitSubject {
	return { kind: "deployment", id };
}

/** Raw operator domains never appear in Redis key names or discovery responses. */
export function capacitySubject(
	deploymentId: string,
	failureDomain: string | null,
): CircuitSubject {
	const source =
		failureDomain === null
			? `deployment:${deploymentId}`
			: `domain:${failureDomain}`;
	return {
		kind: "capacity",
		id: createHash("sha256").update(source).digest("hex").slice(0, 24),
	};
}

function evalNumbers(value: unknown): number[] {
	if (!Array.isArray(value)) return [];
	return value.map((part) => Number(part));
}

/** Atomically checks both deployment and shared-capacity circuits and owns any half-open probes. */
export async function acquireCircuitPermit(
	deployment: CircuitSubject,
	capacity: CircuitSubject,
	settings: CircuitSettings,
): Promise<PermitResult> {
	const token = randomUUID();
	if (!settings.enabled) {
		const deploymentKeys = keys(deployment);
		const capacityKeys = keys(capacity);
		await redis.del(
			deploymentKeys.cooldown,
			deploymentKeys.cause,
			deploymentKeys.failures,
			deploymentKeys.history,
			deploymentKeys.probe,
			capacityKeys.cooldown,
			capacityKeys.cause,
			capacityKeys.failures,
			capacityKeys.history,
			capacityKeys.probe,
		);
		return {
			allowed: true,
			permit: {
				token,
				deployment,
				capacity,
				deploymentMode: "closed",
				capacityMode: "closed",
			},
		};
	}
	const deploymentKeys = keys(deployment);
	const capacityKeys = keys(capacity);
	const result = evalNumbers(
		await redis.eval(
			ACQUIRE_SCRIPT,
			6,
			deploymentKeys.cooldown,
			deploymentKeys.history,
			deploymentKeys.probe,
			capacityKeys.cooldown,
			capacityKeys.history,
			capacityKeys.probe,
			token,
			settings.probeTtlMs,
		),
	);
	if (result[0] !== 1) {
		return {
			allowed: false,
			blockedBy: result[1] === 2 ? "capacity" : "deployment",
			retryAfterMs: Math.max(1, result[2] ?? settings.probeTtlMs),
		};
	}
	return {
		allowed: true,
		permit: {
			token,
			deployment,
			capacity,
			deploymentMode: result[1] === 1 ? "half_open" : "closed",
			capacityMode: result[2] === 1 ? "half_open" : "closed",
		},
	};
}

function safeCause(cause: CooldownCause): string {
	const hash = createHash("sha256")
		.update(cause.class)
		.update("\0")
		.update(String(cause.status ?? ""))
		.update("\0")
		.update(cause.message);
	try {
		hash.update("\0").update(JSON.stringify(cause.body));
	} catch {
		hash.update("\0[unserializable]");
	}
	return JSON.stringify({
		class: cause.class,
		message: `Upstream ${cause.class} failure`,
		...(cause.status !== undefined ? { status: cause.status } : {}),
		fingerprint: hash.digest("hex").slice(0, 24),
	});
}

async function recordFailure(
	subject: CircuitSubject,
	mode: "threshold" | "immediate" | "half_open",
	permitMode: PermitMode,
	token: string,
	settings: CircuitSettings,
	cause: CooldownCause,
	baseCooldownMs: number,
	jitter: number,
): Promise<number | null> {
	if (!settings.enabled) return null;
	const subjectKeys = keys(subject);
	const effectiveMode = permitMode === "half_open" ? "half_open" : mode;
	const result = evalNumbers(
		await redis.eval(
			RECORD_FAILURE_SCRIPT,
			5,
			subjectKeys.cooldown,
			subjectKeys.cause,
			subjectKeys.failures,
			subjectKeys.history,
			subjectKeys.probe,
			effectiveMode,
			settings.allowedFails,
			settings.failureWindowMs,
			Math.max(1, baseCooldownMs),
			settings.maxCooldownMs,
			Math.max(HISTORY_TTL_MS, settings.maxCooldownMs * 4),
			safeCause(cause),
			token,
			jitter,
		),
	);
	return result[0] === 1 ? (result[1] ?? null) : null;
}

/** Counts one logical request failure toward the deployment circuit's fixed window. */
export async function recordTransientFailure(
	permit: CircuitPermit,
	settings: CircuitSettings,
	cause: CooldownCause,
): Promise<number | null> {
	const openedFor = await recordFailure(
		permit.deployment,
		"threshold",
		permit.deploymentMode,
		permit.token,
		settings,
		cause,
		settings.baseCooldownMs,
		0.9 + Math.random() * 0.2,
	);
	await closeSubject(permit.capacity, permit.capacityMode, permit.token);
	return openedFor;
}

/** Immediately quarantines invalid deployment configuration (credentials/model access). */
export async function recordConfigurationFailure(
	permit: CircuitPermit,
	settings: CircuitSettings,
	cause: CooldownCause,
	cooldownMs: number,
): Promise<number | null> {
	const openedFor = await recordFailure(
		permit.deployment,
		"immediate",
		permit.deploymentMode,
		permit.token,
		{
			...settings,
			maxCooldownMs: Math.max(settings.maxCooldownMs, cooldownMs),
		},
		cause,
		cooldownMs,
		0.9 + Math.random() * 0.2,
	);
	await closeSubject(permit.capacity, permit.capacityMode, permit.token);
	return openedFor;
}

/** Opens a shared capacity circuit without lowering deployment health. */
export async function recordThrottleFailure(
	permit: CircuitPermit,
	settings: CircuitSettings,
	cause: CooldownCause,
	cooldownMs: number,
): Promise<number | null> {
	const openedFor = await recordFailure(
		permit.capacity,
		"immediate",
		permit.capacityMode,
		permit.token,
		{
			...settings,
			maxCooldownMs: Math.max(
				settings.maxCooldownMs,
				Math.ceil(cooldownMs * 1.1),
			),
		},
		cause,
		cooldownMs,
		1 + Math.random() * 0.1,
	);
	await closeSubject(permit.deployment, permit.deploymentMode, permit.token);
	return openedFor;
}

async function closeSubject(
	subject: CircuitSubject,
	mode: PermitMode,
	token: string,
): Promise<void> {
	const subjectKeys = keys(subject);
	if (mode === "closed") {
		await redis.del(subjectKeys.failures);
		return;
	}
	await redis.eval(
		CLOSE_SCRIPT,
		5,
		subjectKeys.cooldown,
		subjectKeys.cause,
		subjectKeys.failures,
		subjectKeys.history,
		subjectKeys.probe,
		token,
	);
}

/** A successful half-open request closes only the probes owned by that attempt. */
export async function closeCircuits(permit: CircuitPermit): Promise<void> {
	await Promise.all([
		closeSubject(permit.deployment, permit.deploymentMode, permit.token),
		closeSubject(permit.capacity, permit.capacityMode, permit.token),
	]);
}

async function releaseSubject(
	subject: CircuitSubject,
	mode: PermitMode,
	token: string,
): Promise<void> {
	if (mode !== "half_open") return;
	const subjectKeys = keys(subject);
	await redis.eval(RELEASE_SCRIPT, 1, subjectKeys.probe, token);
}

/** Releases half-open ownership when an attempt produced no health signal (for example cancellation). */
export async function releaseCircuitPermit(
	permit: CircuitPermit,
): Promise<void> {
	await Promise.all([
		releaseSubject(permit.deployment, permit.deploymentMode, permit.token),
		releaseSubject(permit.capacity, permit.capacityMode, permit.token),
	]);
}

export async function getCircuitSnapshots(
	inputs: Array<{
		deployment: CircuitSubject;
		capacity: CircuitSubject;
	}>,
): Promise<CircuitSnapshot[]> {
	if (inputs.length === 0) return [];
	const pipe = redis.pipeline();
	for (const input of inputs) {
		const deploymentKeys = keys(input.deployment);
		const capacityKeys = keys(input.capacity);
		pipe.pttl(deploymentKeys.cooldown);
		pipe.exists(deploymentKeys.history);
		pipe.pttl(deploymentKeys.probe);
		pipe.pttl(capacityKeys.cooldown);
		pipe.exists(capacityKeys.history);
		pipe.pttl(capacityKeys.probe);
	}
	const result = await pipe.exec();
	return inputs.map((_, index) => {
		const offset = index * 6;
		const deploymentCooldown = Number(result?.[offset]?.[1] ?? -2);
		const deploymentHistory = Number(result?.[offset + 1]?.[1] ?? 0) === 1;
		const deploymentProbe = Number(result?.[offset + 2]?.[1] ?? -2);
		const capacityCooldown = Number(result?.[offset + 3]?.[1] ?? -2);
		const capacityHistory = Number(result?.[offset + 4]?.[1] ?? 0) === 1;
		const capacityProbe = Number(result?.[offset + 5]?.[1] ?? -2);
		if (capacityCooldown > 0)
			return { status: "rate_limited", retryAfterMs: capacityCooldown };
		if (deploymentCooldown > 0)
			return { status: "cooldown", retryAfterMs: deploymentCooldown };
		if (deploymentHistory || capacityHistory) {
			const retryAfterMs = Math.max(deploymentProbe, capacityProbe, 0) || null;
			return {
				status: "half_open",
				retryAfterMs,
				...(retryAfterMs !== null
					? {
							blockedBy:
								capacityProbe >= deploymentProbe
									? ("capacity" as const)
									: ("deployment" as const),
						}
					: {}),
			};
		}
		return { status: "available", retryAfterMs: null };
	});
}

/** Reads redacted causes for operator diagnostics. */
export async function getCircuitCauses(
	subjects: CircuitSubject[],
): Promise<Map<string, CooldownCause>> {
	const output = new Map<string, CooldownCause>();
	if (subjects.length === 0) return output;
	const pipe = redis.pipeline();
	for (const subject of subjects) pipe.get(keys(subject).cause);
	const result = await pipe.exec();
	subjects.forEach((subject, index) => {
		const raw = result?.[index]?.[1];
		if (typeof raw !== "string") return;
		try {
			output.set(`${subject.kind}:${subject.id}`, JSON.parse(raw));
		} catch {
			// Corrupt diagnostic state must never affect routing.
		}
	});
	return output;
}
