import type { CallType } from "./callType.ts";

/** Administrative safety bound; operation leases are deliberately longer than this. */
export const EXECUTION_POLICY_MAX_TOTAL_MS = 3_600_000;

/**
 * How long the gateway waits on an upstream, expressed the way an HTTP client does.
 *
 * The defaults mirror the official OpenAI and Anthropic SDKs (a 600 s read timeout): calling a
 * provider through the gateway must not be less patient than calling it directly. None of these
 * deadlines interprets the model's output - a model that thinks silently for minutes is working,
 * not stalled - so a request only ends when the connection itself stops moving.
 */
export interface ExecutionPolicy {
	/**
	 * JSON: until the complete upstream response has arrived. Stream: until the upstream answers
	 * with response headers.
	 */
	responseMs: number;
	/** Stream only: the longest silence allowed between two upstream bytes. null = no limit. */
	idleMs: number | null;
	/** Request-wide bound across every attempt, retry and fallback. */
	totalMs: number;
	/** Upstream attempts per request, across deployments and fallbacks. */
	maxAttempts: number;
}

export interface OperationExecutionPolicies {
	json: ExecutionPolicy;
	stream: ExecutionPolicy;
}

export type ExecutionPolicies = Record<CallType, OperationExecutionPolicies>;

/**
 * Per-deployment narrowing of the global policy. A pool can mix a fast regional endpoint with a slow
 * batch one, and an operator who knows that can fail over sooner on the fast one.
 *
 * Overrides may only TIGHTEN the effective policy: a deployment must not hold a request past the
 * deadline the operator set for the call type.
 */
export interface ExecutionPolicyOverride {
	responseMs?: number | undefined;
	idleMs?: number | undefined;
	totalMs?: number | undefined;
}

export type ExecutionPolicyOverrides = Partial<
	Record<CallType | "all", ExecutionPolicyOverride>
>;

function tighten(
	base: number | null,
	override: number | undefined,
): number | null {
	if (override === undefined || !Number.isFinite(override) || override <= 0) {
		return base;
	}
	return base === null ? override : Math.min(base, override);
}

/**
 * Overrides written before `responseMs` existed named it `firstOutputMs`. The other retired keys
 * (`reasoningOnlyMs`, `preCommitMs`) have no equivalent and are ignored.
 */
function normalizeOverride(
	raw: (ExecutionPolicyOverride & { firstOutputMs?: number }) | undefined,
): ExecutionPolicyOverride | undefined {
	if (!raw) {
		return;
	}
	return {
		responseMs: raw.responseMs ?? raw.firstOutputMs,
		idleMs: raw.idleMs,
		totalMs: raw.totalMs,
	};
}

/**
 * Resolves the policy a single attempt runs under: the call type's global policy, narrowed by the
 * deployment's override for that call type (or its blanket "all" entry, which the specific one
 * wins over). `maxAttempts` is deliberately not overridable - the retry budget belongs to the
 * request, not to whichever deployment happens to be chosen for one of its attempts.
 */
export function resolveExecutionPolicy(
	base: ExecutionPolicy,
	overrides: ExecutionPolicyOverrides | null | undefined,
	callType: CallType,
): ExecutionPolicy {
	const override = normalizeOverride(overrides?.[callType] ?? overrides?.all);
	if (!override) {
		return base;
	}
	return {
		maxAttempts: base.maxAttempts,
		responseMs:
			tighten(base.responseMs, override.responseMs) ?? base.responseMs,
		idleMs: tighten(base.idleMs, override.idleMs),
		totalMs: tighten(base.totalMs, override.totalMs) ?? base.totalMs,
	};
}

const policy = (
	responseMs: number,
	idleMs: number | null,
	totalMs: number,
	maxAttempts: number,
): ExecutionPolicy => ({ responseMs, idleMs, totalMs, maxAttempts });

const MINUTE = 60_000;

export const DEFAULT_EXECUTION_POLICIES: ExecutionPolicies = {
	chat: {
		json: policy(10 * MINUTE, null, 30 * MINUTE, 3),
		stream: policy(10 * MINUTE, 10 * MINUTE, 60 * MINUTE, 3),
	},
	"images.generations": {
		json: policy(10 * MINUTE, null, 30 * MINUTE, 2),
		stream: policy(10 * MINUTE, 5 * MINUTE, 30 * MINUTE, 2),
	},
	"images.edits": {
		json: policy(10 * MINUTE, null, 30 * MINUTE, 2),
		stream: policy(10 * MINUTE, 5 * MINUTE, 30 * MINUTE, 2),
	},
	"audio.transcriptions": {
		json: policy(15 * MINUTE, null, 30 * MINUTE, 2),
		stream: policy(10 * MINUTE, 5 * MINUTE, 30 * MINUTE, 2),
	},
	// A live session: `response` covers connecting and the provider accepting the configuration;
	// silence is normal, so nothing watches it; `total` is the session's whole life.
	"realtime.transcription": {
		json: policy(MINUTE, null, 60 * MINUTE, 2),
		stream: policy(MINUTE, null, 60 * MINUTE, 2),
	},
	embeddings: {
		json: policy(2 * MINUTE, null, 5 * MINUTE, 3),
		stream: policy(2 * MINUTE, null, 5 * MINUTE, 3),
	},
	rerank: {
		json: policy(2 * MINUTE, null, 5 * MINUTE, 3),
		stream: policy(2 * MINUTE, null, 5 * MINUTE, 3),
	},
	"videos.generations": {
		json: policy(2 * MINUTE, null, 5 * MINUTE, 2),
		stream: policy(2 * MINUTE, 2 * MINUTE, 15 * MINUTE, 2),
	},
};

function isPolicy(value: unknown): value is ExecutionPolicy {
	if (value === null || typeof value !== "object") {
		return false;
	}
	const candidate = value as Partial<ExecutionPolicy>;
	return (
		typeof candidate.responseMs === "number" &&
		typeof candidate.totalMs === "number" &&
		typeof candidate.maxAttempts === "number" &&
		(candidate.idleMs === null || typeof candidate.idleMs === "number")
	);
}

/**
 * Reads stored policies, falling back to the defaults for any entry written in the retired shape
 * (first-output, pre-commit and reasoning-only deadlines). Those numbers measured model output,
 * not the connection, so they do not translate into the current fields.
 */
export function normalizeExecutionPolicies(stored: unknown): ExecutionPolicies {
	const source =
		stored !== null && typeof stored === "object"
			? (stored as Partial<
					Record<CallType, Partial<OperationExecutionPolicies>>
				>)
			: {};
	const out = {} as ExecutionPolicies;
	for (const callType of Object.keys(
		DEFAULT_EXECUTION_POLICIES,
	) as CallType[]) {
		const defaults = DEFAULT_EXECUTION_POLICIES[callType];
		const entry = source[callType];
		out[callType] = {
			json: isPolicy(entry?.json) ? pickPolicy(entry.json) : defaults.json,
			stream: isPolicy(entry?.stream)
				? pickPolicy(entry.stream)
				: defaults.stream,
		};
	}
	return out;
}

function pickPolicy(value: ExecutionPolicy): ExecutionPolicy {
	return policy(
		value.responseMs,
		value.idleMs,
		value.totalMs,
		value.maxAttempts,
	);
}

/**
 * The stored form. It also carries the retired fields, derived from the current ones, so a gateway
 * from the previous release still reads a valid policy while both run during a rollout. Drop them
 * once no release older than this one can be serving.
 */
export function storableExecutionPolicies(
	policies: ExecutionPolicies,
): Record<string, Record<string, Record<string, number | null>>> {
	const out: Record<string, Record<string, Record<string, number | null>>> = {};
	for (const [callType, modes] of Object.entries(policies)) {
		out[callType] = {};
		for (const [mode, value] of Object.entries(modes) as [
			string,
			ExecutionPolicy,
		][]) {
			const firstOutputMs = Math.min(value.responseMs, value.totalMs);
			const legacy = {
				firstOutputMs,
				reasoningOnlyMs: null,
				preCommitMs: value.totalMs,
			};
			out[callType][mode] = { ...legacy, ...pickPolicy(value) };
		}
	}
	return out;
}
