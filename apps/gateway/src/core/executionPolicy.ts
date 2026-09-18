import type { CallType } from "./callType.ts";

/** Administrative safety bound; operation leases are deliberately longer than this. */
export const EXECUTION_POLICY_MAX_TOTAL_MS = 3_600_000;

export interface ExecutionPolicy {
	firstOutputMs: number;
	/**
	 * Whether `firstOutputMs` is below the deadline the operator configured, because the router
	 * narrowed it for this attempt - adaptively, or against what is left of the request's own
	 * pre-output window. It changes nothing about enforcement and everything about what expiry
	 * means: a deployment that misses the operator's deadline is slow, while one that misses a
	 * deadline the router invented has only shown the router's estimate to be wrong.
	 */
	firstOutputNarrowed?: boolean;
	idleMs: number | null;
	reasoningOnlyMs: number | null;
	preCommitMs: number;
	totalMs: number;
	maxAttempts: number;
}

export interface OperationExecutionPolicies {
	json: ExecutionPolicy;
	stream: ExecutionPolicy;
}

export type ExecutionPolicies = Record<CallType, OperationExecutionPolicies>;

/**
 * Per-deployment narrowing of the global policy. A pool routinely mixes upstreams with very
 * different latency profiles, and one global `firstOutputMs` has to be generous enough for the
 * slowest of them - which is exactly the budget the fastest one then burns before failing over.
 *
 * Overrides may only TIGHTEN the effective policy. Letting a deployment widen it would let one
 * upstream hold a request past the deadline the operator set for the call type, and past the
 * lease and cost assumptions built on it.
 */
export interface ExecutionPolicyOverride {
	firstOutputMs?: number | undefined;
	idleMs?: number | undefined;
	reasoningOnlyMs?: number | undefined;
	preCommitMs?: number | undefined;
	totalMs?: number | undefined;
}

export type ExecutionPolicyOverrides = Partial<
	Record<CallType | "all", ExecutionPolicyOverride>
>;

export interface AdaptiveDeadlineSettings {
	enabled: boolean;
	/** How many times its own typical time-to-first-output a deployment is granted. */
	multiplier: number;
	/** Lower bound, so a very fast deployment is not cut off by ordinary variance. */
	floorMs: number;
}

/**
 * The two conditions under which narrowing a first-output deadline is sound at all.
 *
 * Both are properties of the attempt being built, not of the deployment, which is why the router
 * supplies them per attempt rather than storing them alongside the EWMA.
 */
export interface AdaptiveDeadlineScope {
	/**
	 * Whether first output really arrives before the answer is finished. In streaming mode it does:
	 * the deadline covers the first event, and the measurement it is compared against means the same
	 * thing. In JSON mode the upstream sends nothing until the whole completion exists, so
	 * `firstOutputMs` is a total-generation budget and the EWMA is an average of past total
	 * generations - a number that says how long SHORT answers took, applied to an answer whose
	 * length is not known yet.
	 */
	incremental: boolean;
	/** Deployments this request could still fail over to if the chosen one is abandoned. */
	alternatives: number;
	/**
	 * Attempts this request has already spent on this deployment. The EWMA only moves on success, so
	 * a narrowed deadline that just expired will be recomputed identically for the next attempt: the
	 * retry re-runs an experiment whose result is already known. Each prior attempt therefore doubles
	 * the granted budget, which is the router admitting that its estimate was wrong about THIS
	 * request rather than repeating it until the attempt budget runs out.
	 */
	priorAttempts: number;
}

/**
 * Narrows the first-output deadline to what THIS deployment actually takes.
 *
 * A pool-wide budget has to accommodate its slowest member, so a deployment that normally answers
 * in a second is granted the same minutes-long grace as one that legitimately takes them - and a
 * request stuck behind it waits out the whole budget before failing over to a healthy sibling.
 * The EWMA is only an estimate, so the result never widens the configured deadline and never drops
 * below `floorMs`; a deployment with no measurement yet keeps the configured value.
 *
 * That whole argument rests on two premises, and `scope` is where they are checked rather than
 * assumed. Failing over early is only worth anything when there is somewhere to fail over TO: with
 * a single candidate the narrowed deadline cannot save a request, it can only end one that was
 * still being served. And comparing an elapsed time against the EWMA is only meaningful when both
 * measure the same event - which stops being true in JSON mode, where nothing arrives until the
 * answer is complete and the EWMA therefore describes the length of past answers instead of the
 * responsiveness of the upstream. When either premise fails the configured deadline stands.
 */
export function adaptiveFirstOutputMs(
	configuredMs: number,
	ttftEwmaMs: number | null | undefined,
	adaptive: AdaptiveDeadlineSettings,
	scope: AdaptiveDeadlineScope,
): number {
	if (!adaptive.enabled) return configuredMs;
	if (!scope.incremental || scope.alternatives < 1) return configuredMs;
	if (
		ttftEwmaMs === null ||
		ttftEwmaMs === undefined ||
		!Number.isFinite(ttftEwmaMs) ||
		ttftEwmaMs <= 0
	)
		return configuredMs;
	const budget = Math.ceil(
		ttftEwmaMs * adaptive.multiplier * 2 ** Math.max(0, scope.priorAttempts),
	);
	return Math.min(configuredMs, Math.max(adaptive.floorMs, budget));
}

function tighten(
	base: number | null,
	override: number | undefined,
): number | null {
	if (override === undefined || !Number.isFinite(override) || override <= 0)
		return base;
	return base === null ? override : Math.min(base, override);
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
	const override = overrides?.[callType] ?? overrides?.all;
	if (!override) return base;
	return {
		maxAttempts: base.maxAttempts,
		firstOutputMs:
			tighten(base.firstOutputMs, override.firstOutputMs) ?? base.firstOutputMs,
		idleMs: tighten(base.idleMs, override.idleMs),
		reasoningOnlyMs: tighten(base.reasoningOnlyMs, override.reasoningOnlyMs),
		preCommitMs:
			tighten(base.preCommitMs, override.preCommitMs) ?? base.preCommitMs,
		totalMs: tighten(base.totalMs, override.totalMs) ?? base.totalMs,
	};
}

const policy = (
	firstOutputMs: number,
	idleMs: number | null,
	reasoningOnlyMs: number | null,
	preCommitMs: number,
	totalMs: number,
	maxAttempts: number,
): ExecutionPolicy => ({
	firstOutputMs,
	idleMs,
	reasoningOnlyMs,
	preCommitMs,
	totalMs,
	maxAttempts,
});

export const DEFAULT_EXECUTION_POLICIES: ExecutionPolicies = {
	chat: {
		json: policy(300_000, null, null, 300_000, 600_000, 6),
		stream: policy(180_000, 180_000, null, 300_000, 600_000, 6),
	},
	"images.generations": {
		json: policy(60_000, null, null, 180_000, 600_000, 3),
		stream: policy(60_000, 60_000, null, 180_000, 600_000, 3),
	},
	"images.edits": {
		json: policy(60_000, null, null, 180_000, 600_000, 3),
		stream: policy(60_000, 60_000, null, 180_000, 600_000, 3),
	},
	"audio.transcriptions": {
		json: policy(60_000, null, null, 180_000, 900_000, 2),
		stream: policy(60_000, 60_000, null, 180_000, 900_000, 2),
	},
	embeddings: {
		json: policy(30_000, null, null, 60_000, 60_000, 3),
		stream: policy(30_000, null, null, 60_000, 60_000, 3),
	},
	rerank: {
		json: policy(30_000, null, null, 60_000, 60_000, 3),
		stream: policy(30_000, null, null, 60_000, 60_000, 3),
	},
	"videos.generations": {
		json: policy(60_000, null, null, 120_000, 120_000, 3),
		stream: policy(30_000, 30_000, null, 60_000, 900_000, 2),
	},
};
