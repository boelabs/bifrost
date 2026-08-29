import { getEffectiveSettings, type EffectiveSettings } from "./settings.ts";
import type { AdapterContext, AdapterDiagnostics } from "#adapters/types.ts";
import type { CanonicalTerminal } from "#gateway/streamLifecycle.ts";
import { beginUpstreamAttempt } from "#logging/operations.ts";
import { isClientAbortSignal } from "#gateway/abortReason.ts";
import type { UpstreamTransport } from "#core/transport.ts";
import { getFallbackPolicy } from "#db/repos/router.ts";
import type { CallType } from "#core/callType.ts";
import { resolveTransport } from "./transport.ts";
import { pickDeployment } from "./strategies.ts";
import { GatewayError } from "#core/errors.ts";
import { computeCost } from "#logging/cost.ts";
import type { Usage } from "#core/usage.ts";
import { log } from "#logging/log.ts";

import {
	recordConfigurationFailure,
	recordTransientFailure,
	recordThrottleFailure,
	type CircuitSettings,
	acquireCircuitPermit,
	releaseCircuitPermit,
	getCircuitSnapshots,
	deploymentSubject,
	getCircuitCauses,
	capacitySubject,
	closeCircuits,
} from "./circuit.ts";

import {
	onAttemptGatewayFinish,
	type CooldownCause,
	type AttemptLease,
	onAttemptFailure,
	onAttemptCancel,
	onSuccessFinish,
	onAttemptStart,
	fetchMetrics,
} from "./state.ts";

import {
	finishUpstreamAttemptTelemetry,
	finishOperationChildTelemetry,
	startUpstreamAttemptTelemetry,
	startOperationChildTelemetry,
} from "#telemetry/index.ts";

import {
	decryptDeploymentCredentials,
	listDeploymentCandidates,
	type DeploymentCandidate,
} from "#gateway/deploymentCandidates.ts";

import {
	finishDownstreamWriteObservation,
	type DownstreamWriteObservation,
} from "#endpoints/runtime/sse.ts";

export interface RouteOptions {
	clientSignal: AbortSignal;
	requestId: string;
	/** Preferred native transport when the selected adapter supports it. */
	preferredTransport?: UpstreamTransport;
	/** Optional request-aware preference resolved separately for each candidate. */
	transportPreference?: (
		candidate: DeploymentCandidate,
	) => UpstreamTransport | undefined;
	/** Excludes deployments incompatible with the request before balancing, without cooldown. */
	candidateEligibility?: (candidate: DeploymentCandidate) => void;
	/** Session affinity hint; used only when this deployment is still healthy and eligible. */
	preferredDeploymentId?: string;
	executionMode?: "json" | "stream";
	/** Remaining request-wide attempt budget for a pre-output retry coordinator. */
	maxAttempts?: number;
	/** Request-wide deadline used before any semantic output is committed. */
	preOutputDeadlineAt?: number;
	/** Request-wide hard deadline, retained when pre-output stream retries re-enter route(). */
	totalDeadlineAt?: number;
	/** Deployments already failed by a returned stream; reuse only after alternatives are exhausted. */
	previousDeploymentIds?: ReadonlySet<string>;
	/** Durable operation identity used to persist the attempt before contacting upstream. */
	operationId?: string;
	/** Offset used when a pre-output coordinator re-enters the router. */
	attemptOrdinalOffset?: number;
	/** Conservative upper bound reserved against a deployment TPM limit before execution. */
	tokenReservation?: (candidate: DeploymentCandidate) => number;
	/** Optional public-key quota admission, kept provider-independent through this lifecycle contract. */
	usageQuota?: UsageQuota;
}

function preferredTransportForCandidate(
	candidate: DeploymentCandidate,
	opts: RouteOptions,
): UpstreamTransport | undefined {
	return opts.transportPreference?.(candidate) ?? opts.preferredTransport;
}

export interface UsageQuotaLease {
	settle(usage: Usage): Promise<void>;
	release(): Promise<void>;
}

export interface UsageQuota {
	assertCandidate(candidate: DeploymentCandidate): void;
	reserve(
		candidate: DeploymentCandidate,
		reservedTokens: number,
	): Promise<UsageQuotaLease>;
}

/** Executes the upstream call for a candidate; throws GatewayError on failure. */
export type ExecuteFn<T> = (
	candidate: DeploymentCandidate,
	ctx: AdapterContext,
) => Promise<T>;

/** Record for one router attempt against a deployment (for logs/observability). */
interface AttemptRecord {
	deploymentId: string;
	/** Operator label of the attempted deployment, snapshotted for failover-readable logs. */
	label?: string;
	adapterKey: string;
	transport: string;
	ms: number;
	startedAt: number;
	endedAt: number;
	ok: boolean;
	errorClass?: string;
	errorCode?: string | null;
	failureKind?: string;
	httpStatus?: number;
	/** Present for failures intentionally excluded from deployment health and cooldown accounting. */
	deploymentHealth?: "neutral";
	/** Raw provider status (if the failure came from upstream). */
	providerStatus?: number;
	/** Raw provider body (truncated before storage). */
	providerBody?: unknown;
	terminalOutcome?: CanonicalTerminal["outcome"];
	terminalReason?: CanonicalTerminal["reason"];
	terminalVerified?: boolean;
	headersMs?: number;
	firstEventMs?: number;
	firstReasoningMs?: number;
	firstOutputMs?: number;
	maxInterEventGapMs?: number;
	frames?: number;
	metadataFrames?: number;
	reasoningFrames?: number;
	contentFrames?: number;
	toolFrames?: number;
	mediaFrames?: number;
	usageFrames?: number;
	downstreamBlockedMs?: number;
	upstreamBytes?: number;
	downstreamBytes?: number;
	lastProgressAt?: number;
	transportTerminator?: string;
	usage?: Usage | null;
	estimatedCostCents?: number;
	diagnostics?: AdapterDiagnostics;
}

export interface RouteResult<T> {
	candidate: DeploymentCandidate;
	value: T;
	attempts: number;
	fallbackUsed: boolean;
	/**
	 * Epoch (ms) when the WINNING attempt's execute() started (just before the upstream fetch).
	 * Lets us compute the upstream TTFT: for non-stream, (route-return − this); for stream,
	 * (first-token instant − this). Isolates the gateway overhead (auth/routing/retries).
	 */
	upstreamStartedAt: number;
	/** Per-attempt detail (includes fallbacks). */
	attemptLog: AttemptRecord[];
	/**
	 * Call on completion (json: after responding; stream: in finally) to release inflight and record
	 * TPM. `finishedAt`, if given, is the epoch ms when upstream actually finished responding (e.g. the
	 * last upstream chunk received) - pass it for streaming so latency/throughput metrics reflect
	 * upstream speed, not how long relaying the response to the client additionally took. Defaults to
	 * `Date.now()`, which is accurate for the non-streaming case (finish() runs before the client write).
	 */
	finish: (
		usage: Usage | null,
		finishedAt?: number,
		streamError?: GatewayError | null,
		terminalOverride?: CanonicalTerminal | null,
		downstream?: DownstreamWriteObservation,
	) => Promise<void>;
}

type FallbackReason = "general" | "context_window" | "content_policy";

function fallbackReasonForFailures(
	failures: Set<FallbackReason>,
): FallbackReason {
	if (failures.size !== 1) return "general";
	const [only] = failures;
	return only ?? "general";
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function settleSideEffects(
	requestId: string,
	tasks: Promise<unknown>[],
): Promise<void> {
	const results = await Promise.allSettled(tasks);
	for (const result of results) {
		if (result.status === "fulfilled") continue;
		log.error("router-settlement", "settlement side effect failed", {
			requestId,
			err: result.reason,
		});
	}
}

function terminalFromValue(value: unknown): CanonicalTerminal | null {
	if (value === null || typeof value !== "object") return null;
	const record = value as {
		terminal?: CanonicalTerminal;
		observation?: { terminal?: CanonicalTerminal | null };
	};
	return record.terminal ?? record.observation?.terminal ?? null;
}

function buildContext(
	candidate: DeploymentCandidate,
	callType: CallType,
	settings: EffectiveSettings,
	opts: RouteOptions,
	attemptStartedAt: number,
): { ctx: AdapterContext; cleanup: () => void } {
	const configuredPolicy =
		settings.executionPolicies[callType][opts.executionMode ?? "json"];
	const remainingPreOutputMs = opts.preOutputDeadlineAt
		? Math.max(1, opts.preOutputDeadlineAt - Date.now())
		: configuredPolicy.preCommitMs;
	const remainingTotalMs = opts.totalDeadlineAt
		? Math.max(1, opts.totalDeadlineAt - Date.now())
		: configuredPolicy.totalMs;
	const executionPolicy = {
		...configuredPolicy,
		firstOutputMs: Math.min(
			configuredPolicy.firstOutputMs,
			remainingPreOutputMs,
		),
		totalMs: Math.min(configuredPolicy.totalMs, remainingTotalMs),
	};
	const controller = new AbortController();
	const abortFromClient = () =>
		controller.abort({ owner: "client", type: "cancelled" });
	if (opts.clientSignal.aborted) abortFromClient();
	else
		opts.clientSignal.addEventListener("abort", abortFromClient, {
			once: true,
		});
	const timeout = setTimeout(
		() =>
			controller.abort({
				owner: "gateway",
				type: "timeout",
				phase: opts.executionMode === "stream" ? "streaming" : "headers",
			}),
		executionPolicy.totalMs,
	);
	timeout.unref?.();
	return {
		ctx: {
			upstreamModel: candidate.upstreamModel,
			credentials: decryptDeploymentCredentials(candidate),
			meta: candidate.meta,
			transport: resolveTransport(
				candidate,
				callType,
				preferredTransportForCandidate(candidate, opts),
			),
			requestId: opts.requestId,
			...(opts.operationId ? { operationId: opts.operationId } : {}),
			attemptStartedAt,
			executionPolicy,
			diagnostics: {},
			signal: controller.signal,
		},
		cleanup: () => {
			clearTimeout(timeout);
			opts.clientSignal.removeEventListener("abort", abortFromClient);
			if (!controller.signal.aborted)
				controller.abort({ owner: "gateway", type: "settled" });
		},
	};
}

/**
 * Generic router: balancing + bounded retries + atomic circuits + per-reason fallbacks, for any
 * CallType. The concrete execution is injected via `execute`.
 */
export async function route<T>(
	publicModel: string,
	callType: CallType,
	opts: RouteOptions,
	execute: ExecuteFn<T>,
): Promise<RouteResult<T>> {
	const routingTelemetry = opts.operationId
		? startOperationChildTelemetry(opts.operationId, "routing")
		: null;
	let routingErrorCode: string | null = null;
	try {
		const settings = await getEffectiveSettings();
		const executionPolicy =
			settings.executionPolicies[callType][opts.executionMode ?? "json"];
		const preOutputDeadlineAt =
			opts.preOutputDeadlineAt ?? Date.now() + executionPolicy.preCommitMs;
		const totalDeadlineAt =
			opts.totalDeadlineAt ?? Date.now() + executionPolicy.totalMs;
		const deadlineOptions: RouteOptions = {
			...opts,
			preOutputDeadlineAt,
			totalDeadlineAt,
		};
		const attemptLimit = Math.min(
			executionPolicy.maxAttempts,
			opts.maxAttempts ?? executionPolicy.maxAttempts,
		);
		const circuitSettings: CircuitSettings = {
			enabled: settings.cooldownSeconds > 0,
			allowedFails: settings.allowedFails,
			failureWindowMs: settings.failureWindowSeconds * 1000,
			baseCooldownMs: settings.cooldownSeconds * 1000,
			maxCooldownMs: settings.maxCooldownSeconds * 1000,
			probeTtlMs: settings.halfOpenProbeSeconds * 1000,
		};
		let attempts = 0;
		let lastError: GatewayError | undefined;
		let eligibilityError: GatewayError | undefined;
		let neutralCandidateError: GatewayError | undefined;
		let deploymentFailureCount = 0;
		let shortestRetryAfterMs: number | undefined;
		const attemptLog: AttemptRecord[] = [];
		const countedTransientDeployments = new Set<string>();
		const attemptsByDeployment = new Map<string, number>();
		const requestExhaustedDeployments = new Set<string>();

		type PublicModelAttempt =
			| { ok: true; result: RouteResult<T> }
			| { ok: false; fallbackReason: FallbackReason; reason: FailReason };

		// `preloaded` lets us reuse the candidates already queried for the primary public model and
		// avoids a second identical SELECT on the hot path. Fallbacks query on-demand.
		async function tryPublicModel(
			candidatePublicModel: string,
			fallbackUsed: boolean,
			preloaded?: DeploymentCandidate[],
			poolAttemptLimit = attemptLimit,
		): Promise<PublicModelAttempt> {
			const listed =
				preloaded ??
				(await listDeploymentCandidates(candidatePublicModel, callType));
			const eligibleCandidates =
				opts.candidateEligibility || opts.usageQuota
					? listed.filter((candidate) => {
							try {
								opts.candidateEligibility?.(candidate);
								opts.usageQuota?.assertCandidate(candidate);
								return true;
							} catch (error) {
								if (!GatewayError.is(error) || error.class !== "bad_request")
									throw error;
								eligibilityError ??= error;
								return false;
							}
						})
					: listed;
			const freshCandidates = opts.previousDeploymentIds
				? eligibleCandidates.filter(
						(candidate) => !opts.previousDeploymentIds?.has(candidate.row.id),
					)
				: eligibleCandidates;
			const candidates =
				freshCandidates.length > 0 ? freshCandidates : eligibleCandidates;
			if (candidates.length === 0) {
				return {
					ok: false,
					fallbackReason: "general",
					reason: "no_candidates",
				};
			}

			const blockedDeployments = new Set<string>();
			const blockedCapacity = new Set<string>();
			const rateLimitedDeployments = new Set<string>();
			const failureReasons = new Set<FallbackReason>();
			const maxAttemptsPerPool = Math.max(
				0,
				Math.min(poolAttemptLimit, attemptLimit - attempts),
			);
			const reusableCandidates = candidates.filter(
				(candidate) => !requestExhaustedDeployments.has(candidate.row.id),
			);
			const maxAttemptsPerDeployment =
				Math.min(
					...reusableCandidates.map(
						(candidate) => attemptsByDeployment.get(candidate.row.id) ?? 0,
					),
				) + 1;
			const poolStartedAt = attempts;
			let reason: FailReason = "exhausted";

			if (circuitSettings.enabled) {
				const subjects = candidates.map((candidate) => ({
					deployment: deploymentSubject(candidate.row.id),
					capacity: capacitySubject(
						candidate.row.id,
						candidate.row.failureDomain,
					),
				}));
				const snapshots = await getCircuitSnapshots(subjects);
				snapshots.forEach((snapshot, index) => {
					const subject = subjects[index];
					if (!snapshot || !subject) return;
					if (snapshot.status === "cooldown")
						blockedDeployments.add(subject.deployment.id);
					if (snapshot.status === "rate_limited")
						blockedCapacity.add(subject.capacity.id);
					if (
						snapshot.status === "half_open" &&
						snapshot.blockedBy === "deployment"
					)
						blockedDeployments.add(subject.deployment.id);
					if (
						snapshot.status === "half_open" &&
						snapshot.blockedBy === "capacity"
					)
						blockedCapacity.add(subject.capacity.id);
					if (snapshot.retryAfterMs !== null) {
						shortestRetryAfterMs =
							shortestRetryAfterMs === undefined
								? snapshot.retryAfterMs
								: Math.min(shortestRetryAfterMs, snapshot.retryAfterMs);
					}
				});
			}

			while (true) {
				if (attempts >= attemptLimit || Date.now() >= preOutputDeadlineAt) {
					reason = "attempt_budget";
					break;
				}
				if (attempts - poolStartedAt >= maxAttemptsPerPool) break;
				const selectableCandidates = candidates.filter((candidate) => {
					const capacity = capacitySubject(
						candidate.row.id,
						candidate.row.failureDomain,
					);
					return (
						!requestExhaustedDeployments.has(candidate.row.id) &&
						(attemptsByDeployment.get(candidate.row.id) ?? 0) <
							maxAttemptsPerDeployment &&
						!blockedDeployments.has(candidate.row.id) &&
						!rateLimitedDeployments.has(candidate.row.id) &&
						!blockedCapacity.has(capacity.id)
					);
				});
				const minRequestAttempts = Math.min(
					...selectableCandidates.map(
						(candidate) => attemptsByDeployment.get(candidate.row.id) ?? 0,
					),
				);
				const withAttemptsLeft = selectableCandidates.filter(
					(candidate) =>
						(attemptsByDeployment.get(candidate.row.id) ?? 0) ===
						minRequestAttempts,
				);
				if (withAttemptsLeft.length === 0) {
					if (rateLimitedDeployments.size > 0 || blockedCapacity.size > 0)
						reason = "rate_limited";
					else if (blockedDeployments.size > 0) reason = "cooldown";
					break;
				}

				// Metrics guide balancing only. The authoritative RPM/TPM decision is an atomic reservation
				// after circuit admission, eliminating the read-then-increment race between replicas.
				const metrics = await fetchMetrics(
					withAttemptsLeft.map((c) => c.row.id),
				);

				const chosen =
					withAttemptsLeft.find(
						(candidate) => candidate.row.id === opts.preferredDeploymentId,
					) ??
					pickDeployment(settings.routingStrategy, withAttemptsLeft, metrics);
				const transport = resolveTransport(
					chosen,
					callType,
					preferredTransportForCandidate(chosen, opts),
				);
				const deployment = deploymentSubject(chosen.row.id);
				const capacity = capacitySubject(
					chosen.row.id,
					chosen.row.failureDomain,
				);
				const permitResult = await acquireCircuitPermit(
					deployment,
					capacity,
					circuitSettings,
				);
				if (!permitResult.allowed) {
					if (permitResult.blockedBy === "deployment")
						blockedDeployments.add(chosen.row.id);
					else blockedCapacity.add(capacity.id);
					shortestRetryAfterMs =
						shortestRetryAfterMs === undefined
							? permitResult.retryAfterMs
							: Math.min(shortestRetryAfterMs, permitResult.retryAfterMs);
					reason =
						permitResult.blockedBy === "capacity" ? "rate_limited" : "cooldown";
					continue;
				}
				const permit = permitResult.permit;
				let attemptLease: AttemptLease | null = null;
				let usageQuotaLease: UsageQuotaLease | undefined;
				const reservedTokens = opts.tokenReservation?.(chosen) ?? 0;
				try {
					usageQuotaLease = await opts.usageQuota?.reserve(
						chosen,
						reservedTokens,
					);
					const admission = await onAttemptStart(chosen.row.id, {
						rpmLimit: chosen.row.rpmLimit,
						tpmLimit: chosen.row.tpmLimit,
						reservedTokens,
					});
					if (!admission.accepted) {
						await usageQuotaLease?.release();
						await releaseCircuitPermit(permit);
						rateLimitedDeployments.add(chosen.row.id);
						reason = "rate_limited";
						continue;
					}
					attemptLease = admission.lease;
				} catch (error) {
					await usageQuotaLease?.release();
					if (attemptLease)
						await onAttemptCancel(chosen.row.id, permit, attemptLease);
					else await releaseCircuitPermit(permit);
					if (
						GatewayError.is(error) &&
						(error.code === "budget_exceeded" ||
							error.code === "rate_limit_exceeded")
					) {
						neutralCandidateError ??= error;
						rateLimitedDeployments.add(chosen.row.id);
						reason = "rate_limited";
						continue;
					}
					throw error;
				}
				const activeAttemptLease = attemptLease;
				if (!activeAttemptLease)
					throw new Error(
						"Deployment admission completed without an attempt lease",
					);

				attemptsByDeployment.set(
					chosen.row.id,
					(attemptsByDeployment.get(chosen.row.id) ?? 0) + 1,
				);
				attempts += 1;
				const startedAt = Date.now();
				const attemptOrdinal = (opts.attemptOrdinalOffset ?? 0) + attempts;
				try {
					if (opts.operationId) {
						await beginUpstreamAttempt({
							operationId: opts.operationId,
							ordinal: attemptOrdinal,
							deploymentId: chosen.row.id,
							deploymentLabel: chosen.row.label ?? null,
							adapterKey: chosen.adapter.key,
							transport,
							upstreamModel: chosen.upstreamModel,
							startedAt: new Date(startedAt),
							requestId: opts.requestId,
						});
					}
				} catch (error) {
					await settleSideEffects(opts.requestId, [
						usageQuotaLease?.release() ?? Promise.resolve(),
						onAttemptCancel(chosen.row.id, permit, activeAttemptLease),
					]);
					throw error;
				}
				const attemptTelemetry = startUpstreamAttemptTelemetry({
					requestId: opts.requestId,
					...(opts.operationId ? { operationId: opts.operationId } : {}),
					ordinal: attemptOrdinal,
					deploymentId: chosen.row.id,
					adapterKey: chosen.adapter.key,
					transport,
					upstreamModel: chosen.upstreamModel,
					startedAt,
				});
				let cleanupContext = () => {};
				let activeContext: AdapterContext | undefined;
				try {
					const instrumentedContext = buildContext(
						chosen,
						callType,
						settings,
						deadlineOptions,
						startedAt,
					);
					activeContext = instrumentedContext.ctx;
					cleanupContext = instrumentedContext.cleanup;
					const value = await execute(chosen, instrumentedContext.ctx);
					const ms = Date.now() - startedAt;
					const attemptRecord: AttemptRecord = {
						deploymentId: chosen.row.id,
						...(chosen.row.label != null ? { label: chosen.row.label } : {}),
						adapterKey: chosen.adapter.key,
						transport,
						ms,
						startedAt,
						endedAt: Date.now(),
						lastProgressAt:
							instrumentedContext.ctx.timings?.headersAt ?? startedAt,
						headersMs:
							(instrumentedContext.ctx.timings?.headersAt ?? Date.now()) -
							startedAt,
						// The upstream only accepted the request. Streaming success is decided when the
						// iterator reaches a verified semantic terminal.
						ok: false,
					};
					attemptLog.push(attemptRecord);
					let settled = false;
					return {
						ok: true,
						result: {
							candidate: chosen,
							value,
							attempts,
							fallbackUsed,
							upstreamStartedAt: startedAt,
							attemptLog,
							finish: async (
								usage,
								finishedAt,
								streamError,
								terminalOverride,
								downstream,
							) => {
								if (settled) return;
								settled = true;
								if (downstream)
									finishDownstreamWriteObservation(
										downstream,
										streamError?.code,
									);
								cleanupContext();
								const endedAt = finishedAt ?? Date.now();
								attemptRecord.ms = endedAt - startedAt;
								attemptRecord.endedAt = endedAt;
								attemptRecord.upstreamBytes =
									instrumentedContext.ctx.transportStats?.upstreamBytes ?? 0;
								const terminal = terminalOverride ?? terminalFromValue(value);
								const observation =
									value !== null && typeof value === "object"
										? (
												value as {
													observation?: {
														frames: number;
														metadataFrames: number;
														reasoningFrames: number;
														contentFrames: number;
														toolFrames: number;
														mediaFrames: number;
														usageFrames: number;
														usage: Usage | null;
														transportTerminator: string | null;
														lastEventAt: number | null;
														firstEventAt: number | null;
														firstReasoningAt: number | null;
														firstOutputAt: number | null;
														maxInterEventGapMs: number;
														diagnostics?: AdapterDiagnostics;
													};
												}
											).observation
										: undefined;
								attemptRecord.usage = usage ?? observation?.usage ?? null;
								if (usageQuotaLease) {
									await settleSideEffects(opts.requestId, [
										attemptRecord.usage
											? usageQuotaLease.settle(attemptRecord.usage)
											: usageQuotaLease.release(),
									]);
								}
								if (downstream)
									attemptRecord.downstreamBlockedMs = downstream.maxBlockedMs;
								if (downstream)
									attemptRecord.downstreamBytes = downstream.bytes;
								if (attemptRecord.usage)
									attemptRecord.estimatedCostCents = computeCost(
										chosen.meta,
										attemptRecord.usage,
									).totalCents;
								if (
									value !== null &&
									typeof value === "object" &&
									"diagnostics" in value &&
									(value as { diagnostics?: AdapterDiagnostics }).diagnostics
								)
									attemptRecord.diagnostics = (
										value as { diagnostics: AdapterDiagnostics }
									).diagnostics;
								if (observation) {
									attemptRecord.frames = observation.frames;
									attemptRecord.metadataFrames = observation.metadataFrames;
									attemptRecord.reasoningFrames = observation.reasoningFrames;
									attemptRecord.contentFrames = observation.contentFrames;
									attemptRecord.toolFrames = observation.toolFrames;
									attemptRecord.mediaFrames = observation.mediaFrames;
									attemptRecord.usageFrames = observation.usageFrames;
									if (observation.firstEventAt !== null)
										attemptRecord.firstEventMs =
											observation.firstEventAt - startedAt;
									if (observation.firstReasoningAt !== null)
										attemptRecord.firstReasoningMs =
											observation.firstReasoningAt - startedAt;
									if (observation.firstOutputAt !== null)
										attemptRecord.firstOutputMs =
											observation.firstOutputAt - startedAt;
									attemptRecord.maxInterEventGapMs =
										observation.maxInterEventGapMs;
									attemptRecord.lastProgressAt =
										observation.lastEventAt ?? endedAt;
									if (observation.transportTerminator)
										attemptRecord.transportTerminator =
											observation.transportTerminator;
									if (observation.diagnostics)
										attemptRecord.diagnostics = observation.diagnostics;
								}
								if (!streamError && !terminal) {
									streamError = new GatewayError({
										class: "server",
										code: "upstream_protocol_error",
										message:
											"Upstream execution settled without terminal evidence",
										failureKind: "transient",
										deploymentHealth: "penalize",
									});
								}
								if (!streamError && terminal) {
									attemptRecord.ok = true;
									attemptRecord.terminalVerified = true;
									attemptRecord.terminalOutcome = terminal.outcome;
									attemptRecord.terminalReason = terminal.reason;
									await settleSideEffects(opts.requestId, [
										onSuccessFinish(
											chosen.row.id,
											{
												totalTokens: usage?.totalTokens ?? null,
												completionTokens: usage?.completionTokens ?? null,
												durationMs: endedAt - startedAt,
											},
											permit,
											activeAttemptLease,
										),
									]);
									finishUpstreamAttemptTelemetry(attemptTelemetry, {
										endedAt,
										outcome: terminal.outcome,
										terminalVerified: true,
									});
									return;
								}
								if (!streamError) return;

								attemptRecord.errorClass = streamError.class;
								attemptRecord.errorCode = streamError.code;
								attemptRecord.failureKind = streamError.failureKind;
								attemptRecord.httpStatus = streamError.httpStatus;
								if (streamError.deploymentHealth === "neutral")
									attemptRecord.deploymentHealth = "neutral";
								if (streamError.provider?.status !== undefined)
									attemptRecord.providerStatus = streamError.provider.status;
								if (streamError.provider?.body !== undefined)
									attemptRecord.providerBody = streamError.provider.body;

								if (
									isClientAbortSignal(opts.clientSignal) ||
									streamError.code === "client_closed_request"
								) {
									attemptRecord.errorClass = "client_closed_request";
									attemptRecord.failureKind = "request";
									attemptRecord.deploymentHealth = "neutral";
									await settleSideEffects(opts.requestId, [
										onAttemptCancel(chosen.row.id, permit, activeAttemptLease),
									]);
									finishUpstreamAttemptTelemetry(attemptTelemetry, {
										endedAt,
										outcome: "cancelled",
										terminalVerified: false,
										errorCode: "client_closed_request",
									});
									return;
								}

								const cause: CooldownCause = {
									class: streamError.class,
									message: streamError.message,
									...(streamError.provider?.status !== undefined
										? { status: streamError.provider.status }
										: {}),
									...(streamError.provider?.body !== undefined
										? { body: streamError.provider.body }
										: {}),
								};
								switch (streamError.failureKind) {
									case "transient":
										await settleSideEffects(
											opts.requestId,
											streamError.deploymentHealth === "neutral"
												? [
														onAttemptFailure(
															chosen.row.id,
															false,
															activeAttemptLease,
														),
														closeCircuits(permit),
													]
												: [
														onAttemptFailure(
															chosen.row.id,
															true,
															activeAttemptLease,
														),
														recordTransientFailure(
															permit,
															circuitSettings,
															cause,
														),
													],
										);
										break;
									case "configuration":
										await settleSideEffects(opts.requestId, [
											onAttemptFailure(chosen.row.id, true, activeAttemptLease),
											recordConfigurationFailure(
												permit,
												circuitSettings,
												cause,
												settings.configurationCooldownSeconds * 1000,
											),
										]);
										break;
									case "throttle":
										await settleSideEffects(opts.requestId, [
											onAttemptFailure(
												chosen.row.id,
												false,
												activeAttemptLease,
											),
											recordThrottleFailure(
												permit,
												circuitSettings,
												cause,
												Math.max(
													streamError.retryAfterMs ?? 0,
													settings.throttleCooldownSeconds * 1000,
												),
											),
										]);
										break;
									case "request":
										await settleSideEffects(opts.requestId, [
											onAttemptFailure(
												chosen.row.id,
												false,
												activeAttemptLease,
											),
											closeCircuits(permit),
										]);
										break;
									case "gateway":
										await settleSideEffects(opts.requestId, [
											onAttemptGatewayFinish(
												chosen.row.id,
												attemptRecord.usage?.totalTokens ?? 0,
												permit,
												activeAttemptLease,
											),
										]);
										break;
								}
								finishUpstreamAttemptTelemetry(attemptTelemetry, {
									endedAt,
									outcome: "error",
									terminalVerified: false,
									errorCode: streamError.code,
								});
							},
						},
					};
				} catch (err) {
					cleanupContext();
					if (usageQuotaLease)
						await settleSideEffects(opts.requestId, [
							usageQuotaLease.release(),
						]);
					// If the CLIENT cancelled (not an upstream timeout), it is NOT the deployment's fault:
					// release the inflight, do not count toward allowed_fails/cooldown, and do not retry.
					// Prevents quickly cancelling requests from putting the deployment pool into cooldown.
					if (isClientAbortSignal(opts.clientSignal)) {
						finishUpstreamAttemptTelemetry(attemptTelemetry, {
							endedAt: Date.now(),
							outcome: "cancelled",
							terminalVerified: false,
							errorCode: "client_closed_request",
						});
						await onAttemptCancel(chosen.row.id, permit, activeAttemptLease);
						attemptLog.push({
							deploymentId: chosen.row.id,
							...(chosen.row.label != null ? { label: chosen.row.label } : {}),
							adapterKey: chosen.adapter.key,
							transport,
							ms: Date.now() - startedAt,
							startedAt,
							endedAt: Date.now(),
							lastProgressAt: activeContext?.timings?.headersAt ?? startedAt,
							upstreamBytes: activeContext?.transportStats?.upstreamBytes ?? 0,
							...(activeContext?.timings?.headersAt
								? {
										headersMs: activeContext.timings.headersAt - startedAt,
									}
								: {}),
							...(activeContext?.diagnostics
								? { diagnostics: activeContext.diagnostics }
								: {}),
							ok: false,
							errorClass: "client_closed_request",
							errorCode: "client_closed_request",
							deploymentHealth: "neutral",
						});
						const cancelled = new GatewayError({
							class: "bad_request",
							status: 499,
							code: "client_closed_request",
							message: "Client closed the request before completion",
							routingScope: "request",
						});
						cancelled.attempts = attemptLog;
						throw cancelled;
					}
					const ge = GatewayError.is(err)
						? err
						: new GatewayError({
								class: "server",
								message: String(err),
								failureKind: "gateway",
								deploymentHealth: "neutral",
								retryable: false,
								cause: err,
							});
					finishUpstreamAttemptTelemetry(attemptTelemetry, {
						endedAt: Date.now(),
						outcome: "error",
						terminalVerified: false,
						errorCode: ge.code,
					});
					if (ge.routingScope === "request") {
						await onAttemptCancel(chosen.row.id, permit, activeAttemptLease);
						attemptLog.push({
							deploymentId: chosen.row.id,
							...(chosen.row.label != null ? { label: chosen.row.label } : {}),
							adapterKey: chosen.adapter.key,
							transport,
							ms: Date.now() - startedAt,
							startedAt,
							endedAt: Date.now(),
							lastProgressAt: activeContext?.timings?.headersAt ?? startedAt,
							upstreamBytes: activeContext?.transportStats?.upstreamBytes ?? 0,
							...(activeContext?.timings?.headersAt
								? {
										headersMs: activeContext.timings.headersAt - startedAt,
									}
								: {}),
							...(activeContext?.diagnostics
								? { diagnostics: activeContext.diagnostics }
								: {}),
							ok: false,
							errorClass: ge.class,
							errorCode: ge.code,
							failureKind: ge.failureKind,
							httpStatus: ge.httpStatus,
							deploymentHealth: "neutral",
						});
						ge.attempts = attemptLog;
						throw ge;
					}
					const cause: CooldownCause = {
						class: ge.class,
						message: ge.message,
						...(ge.provider?.status !== undefined
							? { status: ge.provider.status }
							: {}),
						...(ge.provider?.body !== undefined
							? { body: ge.provider.body }
							: {}),
					};
					switch (ge.failureKind) {
						case "transient": {
							if (ge.deploymentHealth === "neutral") {
								await onAttemptFailure(
									chosen.row.id,
									false,
									activeAttemptLease,
								);
								await closeCircuits(permit);
								neutralCandidateError ??= ge;
								break;
							}
							await onAttemptFailure(chosen.row.id, true, activeAttemptLease);
							const firstSignal =
								!countedTransientDeployments.has(chosen.row.id) ||
								permit.deploymentMode === "half_open";
							if (firstSignal) {
								countedTransientDeployments.add(chosen.row.id);
								await recordTransientFailure(permit, circuitSettings, cause);
							}
							deploymentFailureCount += 1;
							break;
						}
						case "configuration":
							await onAttemptFailure(chosen.row.id, true, activeAttemptLease);
							await recordConfigurationFailure(
								permit,
								circuitSettings,
								cause,
								settings.configurationCooldownSeconds * 1000,
							);
							deploymentFailureCount += 1;
							break;
						case "throttle": {
							await onAttemptFailure(chosen.row.id, false, activeAttemptLease);
							const throttleMs = Math.max(
								ge.retryAfterMs ?? 0,
								settings.throttleCooldownSeconds * 1000,
							);
							await recordThrottleFailure(
								permit,
								circuitSettings,
								cause,
								throttleMs,
							);
							shortestRetryAfterMs =
								shortestRetryAfterMs === undefined
									? throttleMs
									: Math.min(shortestRetryAfterMs, throttleMs);
							neutralCandidateError ??= ge;
							break;
						}
						case "request":
							await onAttemptFailure(chosen.row.id, false, activeAttemptLease);
							// A deterministic request rejection still proves a half-open upstream is alive.
							await closeCircuits(permit);
							neutralCandidateError ??= ge;
							break;
						case "gateway":
							await onAttemptCancel(chosen.row.id, permit, activeAttemptLease);
							neutralCandidateError ??= ge;
							break;
					}
					lastError = ge;
					attemptLog.push({
						deploymentId: chosen.row.id,
						...(chosen.row.label != null ? { label: chosen.row.label } : {}),
						adapterKey: chosen.adapter.key,
						transport,
						ms: Date.now() - startedAt,
						startedAt,
						endedAt: Date.now(),
						lastProgressAt: activeContext?.timings?.headersAt ?? startedAt,
						upstreamBytes: activeContext?.transportStats?.upstreamBytes ?? 0,
						...(activeContext?.timings?.headersAt
							? {
									headersMs: activeContext.timings.headersAt - startedAt,
								}
							: {}),
						...(activeContext?.diagnostics
							? { diagnostics: activeContext.diagnostics }
							: {}),
						ok: false,
						errorClass: ge.class,
						errorCode: ge.code,
						failureKind: ge.failureKind,
						httpStatus: ge.httpStatus,
						...(ge.deploymentHealth === "neutral"
							? { deploymentHealth: "neutral" as const }
							: {}),
						...(ge.provider?.status !== undefined
							? { providerStatus: ge.provider.status }
							: {}),
						...(ge.provider?.body !== undefined
							? { providerBody: ge.provider.body }
							: {}),
					});

					const failureReason: FallbackReason =
						ge.class === "context_window"
							? "context_window"
							: ge.class === "content_policy"
								? "content_policy"
								: "general";
					failureReasons.add(failureReason);

					// Deterministic/non-retryable errors exhaust THIS deployment for the request, but do not
					// cut the pool: the other deployments of the same public model are still tried.
					if (!ge.retryable) requestExhaustedDeployments.add(chosen.row.id);

					const hasAttemptsLeft = candidates.some(
						(candidate) =>
							!requestExhaustedDeployments.has(candidate.row.id) &&
							(attemptsByDeployment.get(candidate.row.id) ?? 0) <
								maxAttemptsPerDeployment,
					);
					if (
						ge.failureKind === "transient" &&
						ge.retryable &&
						hasAttemptsLeft &&
						attempts < attemptLimit &&
						attempts - poolStartedAt < maxAttemptsPerPool
					) {
						const exponent = Math.min(5, attempts - poolStartedAt - 1);
						const minimum = Math.max(
							settings.retryAfterSeconds * 1000,
							ge.retryAfterMs ?? 0,
						);
						const jitterCeiling = Math.min(2000, 100 * 2 ** exponent);
						const delay = minimum + Math.floor(Math.random() * jitterCeiling);
						if (Date.now() + delay >= preOutputDeadlineAt) {
							reason = "attempt_budget";
							break;
						}
						await sleep(delay);
					}
				}
			}
			return {
				ok: false,
				fallbackReason:
					reason === "exhausted"
						? fallbackReasonForFailures(failureReasons)
						: "general",
				reason,
			};
		}

		const primaryCandidates = await listDeploymentCandidates(
			publicModel,
			callType,
		);
		if (primaryCandidates.length === 0) {
			throw new GatewayError({
				class: "not_found",
				message: `Public model "${publicModel}" does not exist or has no enabled ${callType} deployments`,
				code: "model_not_found",
			});
		}

		const fallbackReasons: FallbackReason[] = [
			"general",
			"context_window",
			"content_policy",
		];
		const fallbackPolicies = new Map(
			(
				await Promise.all(
					fallbackReasons.map(
						async (reason) =>
							[reason, await getFallbackPolicy(publicModel, reason)] as const,
					),
				)
			).filter((entry) => entry[1] !== undefined),
		);
		const longestFallbackChain = Math.max(
			0,
			...[...fallbackPolicies.values()].map(
				(policy) => policy?.fallbackModels.length ?? 0,
			),
		);
		const reservedFallbackAttempts = Math.min(
			longestFallbackChain,
			Math.max(0, attemptLimit - 1),
		);
		const primary = await tryPublicModel(
			publicModel,
			false,
			primaryCandidates,
			Math.max(1, attemptLimit - reservedFallbackAttempts),
		);
		if (primary.ok) return primary.result;

		let lastReason: FailReason = primary.reason;
		let triedFallback = false;
		const fallbackModels =
			fallbackPolicies.get(primary.fallbackReason)?.fallbackModels ?? [];
		for (const [index, fallbackModel] of fallbackModels.entries()) {
			triedFallback = true;
			const laterFallbacks = fallbackModels.length - index - 1;
			const attempt = await tryPublicModel(
				fallbackModel,
				true,
				undefined,
				Math.max(0, attemptLimit - attempts - laterFallbacks),
			);
			if (attempt.ok) return attempt.result;
			lastReason = attempt.reason;
		}

		// Once every reachable deployment has had a fair first chance, reuse them in rounds until the
		// request-wide policy is exhausted. This preserves retries for a one-deployment pool without
		// allowing a large primary pool to starve configured fallbacks.
		const retryModels = [publicModel, ...fallbackModels];
		let retryRound = 0;
		while (
			attempts < attemptLimit &&
			Date.now() < preOutputDeadlineAt &&
			retryModels.length > 0
		) {
			if (lastError?.failureKind === "transient" && lastError.retryable) {
				const minimum = Math.max(
					settings.retryAfterSeconds * 1000,
					lastError.retryAfterMs ?? 0,
				);
				const jitterCeiling = Math.min(
					2000,
					100 * 2 ** Math.min(5, retryRound),
				);
				const delay = minimum + Math.floor(Math.random() * jitterCeiling);
				if (Date.now() + delay >= preOutputDeadlineAt) {
					lastReason = "attempt_budget";
					break;
				}
				await sleep(delay);
			}

			const roundStartedAt = attempts;
			for (const retryModel of retryModels) {
				if (attempts >= attemptLimit || Date.now() >= preOutputDeadlineAt)
					break;
				const attempt = await tryPublicModel(
					retryModel,
					retryModel !== publicModel,
					undefined,
					1,
				);
				if (attempt.ok) return attempt.result;
				lastReason = attempt.reason;
			}
			if (attempts === roundStartedAt) break;
			retryRound += 1;
		}

		if (deploymentFailureCount === 0 && neutralCandidateError) {
			neutralCandidateError.attempts = attemptLog;
			throw neutralCandidateError;
		}
		if (attempts === 0 && eligibilityError) {
			eligibilityError.attempts = attemptLog;
			throw eligibilityError;
		}

		// Stored redacted causes explain a zero-attempt circuit cut without changing the public error.
		const cooldownCauses =
			lastReason === "cooldown"
				? await getCircuitCauses(
						primaryCandidates.flatMap((candidate) => [
							deploymentSubject(candidate.row.id),
							capacitySubject(candidate.row.id, candidate.row.failureDomain),
						]),
					)
				: new Map<string, CooldownCause>();

		// ROUTING error (gateway info, public and specific): explains why it could not be served.
		// The provider detail (lastError) stays in the internal message (logs).
		const routingError = buildRoutingError({
			publicModel,
			callType,
			attempts,
			reason: lastReason,
			triedFallback,
			retryAfterMs: shortestRetryAfterMs,
			lastError,
			cooldownCauses,
		});
		routingError.attempts = attemptLog;
		throw routingError;
	} catch (error) {
		routingErrorCode = GatewayError.is(error)
			? (error.code ?? error.class)
			: "internal_error";
		throw error;
	} finally {
		if (routingTelemetry)
			finishOperationChildTelemetry(routingTelemetry, routingErrorCode);
	}
}

type FailReason =
	| "no_candidates"
	| "cooldown"
	| "rate_limited"
	| "attempt_budget"
	| "exhausted";

const attemptsLabel = (n: number): string =>
	`${n} attempt${n === 1 ? "" : "s"}`;

/** Readable phrase for the underlying cause (class of the last error), gateway info. */
function causePhrase(cls: GatewayError["class"] | undefined): string {
	switch (cls) {
		case "timeout":
			return "upstream timeouts";
		case "rate_limit":
			return "upstream rate limiting";
		case "context_window":
			return "context window exceeded";
		case "content_policy":
			return "content policy blocks";
		case "auth":
			return "upstream authentication errors";
		default:
			return "upstream errors";
	}
}

function buildRoutingError(p: {
	publicModel: string;
	callType: CallType;
	attempts: number;
	reason: FailReason;
	triedFallback: boolean;
	retryAfterMs: number | undefined;
	lastError: GatewayError | undefined;
	cooldownCauses: Map<string, CooldownCause>;
}): GatewayError {
	const fbNote = p.triedFallback ? " (including fallbacks)" : "";
	const internal =
		`Routing failed for public model "${p.publicModel}" (${p.callType})${fbNote} after ${attemptsLabel(p.attempts)}; ` +
		`reason=${p.reason}; lastError=${p.lastError?.message ?? "n/a"}`;
	// Preserve the RAW response of the last upstream contacted (status + body) in the routing error,
	// so error.provider.body in the logs has the real detail and not just the gateway summary. If no
	// upstream was contacted (e.g. pure cooldown, 0 attempts), lastError is undefined and there is no
	// provider to attach.
	const provider =
		p.lastError?.provider !== undefined
			? { provider: p.lastError.provider }
			: {};

	if (p.reason === "cooldown") {
		// Saved causes (errors that triggered cooldown) -> provider detail for logs.
		const causeProvider =
			p.cooldownCauses.size > 0
				? {
						provider: {
							body: { cooldown_causes: Object.fromEntries(p.cooldownCauses) },
						},
					}
				: provider;
		return new GatewayError({
			class: "server",
			status: 503,
			message: internal,
			publicMessage: `All deployments for public model "${p.publicModel}" are temporarily unavailable${fbNote}. Please retry shortly.`,
			code: "deployments_in_cooldown",
			...(p.retryAfterMs !== undefined
				? {
						headers: {
							"Retry-After": String(
								Math.max(1, Math.ceil(p.retryAfterMs / 1000)),
							),
						},
					}
				: {}),
			...causeProvider,
		});
	}
	if (p.reason === "rate_limited") {
		return new GatewayError({
			class: "rate_limit",
			message: internal,
			publicMessage: `All deployments for public model "${p.publicModel}" are temporarily rate limited${fbNote}, either by configured RPM/TPM limits or by upstream capacity. Please try again later.`,
			code: "rate_limit_exceeded",
			...(p.retryAfterMs !== undefined
				? {
						headers: {
							"Retry-After": String(
								Math.max(1, Math.ceil(p.retryAfterMs / 1000)),
							),
						},
					}
				: {}),
			...provider,
		});
	}
	// exhausted / no_candidates: there were failed attempts (or no eligible deployment).
	const cls = p.lastError?.class ?? "server";
	const cause = p.lastError ? ` (cause: ${causePhrase(cls)})` : "";
	return new GatewayError({
		class: cls,
		message: internal,
		publicMessage: `No deployments for public model "${p.publicModel}" were able to handle the request${fbNote} after ${attemptsLabel(p.attempts)}${cause}. Please try again later.`,
		code: "no_deployments_available",
		...(p.lastError?.httpStatus ? { status: p.lastError.httpStatus } : {}),
		...(p.lastError?.headers ? { headers: p.lastError.headers } : {}),
		...(p.lastError?.retryAfterMs !== undefined
			? { retryAfterMs: p.lastError.retryAfterMs }
			: {}),
		...provider,
	});
}
