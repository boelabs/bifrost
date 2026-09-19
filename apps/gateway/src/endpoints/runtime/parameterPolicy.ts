import { assertStrictTextRequestSupported } from "#gateway/textRequestValidation.ts";
import type { DeploymentCandidate } from "#gateway/deploymentCandidates.ts";
import { estimateTokenReservation } from "#router/tokenReservation.ts";
import type { RouteOptions, RouteResult } from "#router/index.ts";
import { chatChunkSemantic } from "#gateway/streamLifecycle.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { EffectiveSettings } from "#router/settings.ts";
import type { ChatExecResult } from "#gateway/executor.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { resolveTransport } from "#router/transport.ts";
import { usageQuotaForRequest } from "./pipeline.ts";
import { executeChat } from "#gateway/executor.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import { route } from "#router/index.ts";
import type { Context } from "hono";

import {
	type UnsupportedParameterStrategy,
	applyUnsupportedParameterPolicy,
	assertSupportedChatParameters,
	type ParameterPolicyResult,
} from "#catalog/parameters.ts";

import {
	type ContentInputResolutionMetadata,
	MAX_PORTABLE_CONTENT_INPUT_BYTES,
	createContentInputResolver,
} from "#files/requestContentInputs.ts";

export type ParameterPolicyRecorder = (result: ParameterPolicyResult) => void;
export type ChatCandidateExecutor = (
	candidate: DeploymentCandidate,
	ctx: AdapterContext,
	request: CanonicalChatRequest,
) => Promise<ChatExecResult>;

export function parameterEligibility(
	req: CanonicalChatRequest,
	strategy: UnsupportedParameterStrategy,
): RouteOptions["candidateEligibility"] | undefined {
	if (strategy !== "error") {
		return undefined;
	}
	return (candidate) => assertSupportedChatParameters(req, candidate.meta);
}

export function requestForCandidate(
	req: CanonicalChatRequest,
	candidate: DeploymentCandidate,
	strategy: UnsupportedParameterStrategy,
	record: ParameterPolicyRecorder,
): CanonicalChatRequest {
	const result = applyUnsupportedParameterPolicy(req, candidate.meta, strategy);
	record(result);
	return result.request;
}

/**
 * Shared routing wiring for /v1/chat/completions, /v1/messages, and /v1/responses: resolves parameter
 * eligibility/policy for `canonical.model` and routes to a "chat" candidate. Kept in one place so a
 * fix to this wiring (eligibility, policy application, candidate execution) does not have to be
 * copy-pasted into all three endpoints and risk drifting between them.
 */
export async function routeChat(
	c: Context<AppEnv>,
	canonical: CanonicalChatRequest,
	requestId: string,
	settings: EffectiveSettings,
	options?: {
		signal?: AbortSignal;
		execute?: ChatCandidateExecutor;
		preferredDeploymentId?: string;
		operationId?: string;
	},
): Promise<{
	routing: RouteResult<ChatExecResult>;
	parameterPolicy: ParameterPolicyResult | null;
	contentInputResolution: ContentInputResolutionMetadata | null;
}> {
	let parameterPolicy: ParameterPolicyResult | null = null;
	let contentInputResolution: ContentInputResolutionMetadata | null = null;
	const policy =
		settings.executionPolicies.chat[canonical.stream ? "stream" : "json"];
	const startedAt = Date.now();
	const preOutputDeadlineAt = startedAt + policy.preCommitMs;
	const totalDeadlineAt = startedAt + policy.totalMs;
	const clientSignal = options?.signal ?? c.req.raw.signal;
	const contentInputResolver = createContentInputResolver(
		canonical,
		AbortSignal.any([
			clientSignal,
			AbortSignal.timeout(Math.max(1, totalDeadlineAt - Date.now())),
		]),
	);
	const eligibility = parameterEligibility(
		canonical,
		settings.unsupportedParameterStrategy,
	);
	const publicWire = canonical.publicWire ?? "chat_completions";
	const transportForCandidate = (candidate: DeploymentCandidate) =>
		resolveTransport(candidate, "chat");
	const candidateEligibility: NonNullable<
		RouteOptions["candidateEligibility"]
	> = (candidate) => {
		eligibility?.(candidate);
		const transport = transportForCandidate(candidate);
		assertStrictTextRequestSupported(canonical, candidate.meta);
		if (canonical.requiresNativeWire && transport !== publicWire) {
			throw new GatewayError({
				class: "bad_request",
				code: "native_transport_required",
				param: null,
				message: `The request uses ${publicWire} features that the configured transport cannot preserve; configure a ${publicWire} deployment override`,
			});
		}
		candidate.adapter.assertChatRequestSupported?.(canonical, {
			upstreamModel: candidate.upstreamModel,
			meta: candidate.meta,
			transport,
		});
		contentInputResolver.assertCandidate(candidate, transport);
	};
	const previouslyFailed = new Set<string>();
	// Shared across every re-entry below, so the whole request spends at most one transient signal
	// per deployment instead of one per retry.
	const countedTransientDeployments = new Set<string>();
	let remainingAttempts = policy.maxAttempts;
	const failedAttemptLog: RouteResult<ChatExecResult>["attemptLog"] = [];
	let failedAttempts = 0;
	let usedFallback = false;
	const runRoute = () =>
		route<ChatExecResult>(
			canonical.model,
			"chat",
			{
				clientSignal,
				requestId,
				executionMode: canonical.stream ? "stream" : "json",
				maxAttempts: remainingAttempts,
				preOutputDeadlineAt,
				totalDeadlineAt,
				previousDeploymentIds: previouslyFailed,
				attemptOrdinalOffset: failedAttempts,
				countedTransientDeployments,
				...(options?.operationId ? { operationId: options.operationId } : {}),
				...(options?.preferredDeploymentId
					? { preferredDeploymentId: options.preferredDeploymentId }
					: {}),
				candidateEligibility,
				tokenReservation: (candidate) =>
					estimateTokenReservation(canonical, {
						maxOutputTokens:
							canonical.maxTokens ?? candidate.meta.maxOutputTokens ?? 0,
						additionalInputTokens: contentInputResolver.hasOpaqueInputs
							? (candidate.meta.maxInputTokens ??
								MAX_PORTABLE_CONTENT_INPUT_BYTES)
							: 0,
					}),
				usageQuota: usageQuotaForRequest(c),
			},
			async (cand, ctx) => {
				const resolved = await contentInputResolver.resolveForCandidate(
					cand,
					ctx.transport,
				);
				contentInputResolution = resolved.metadata ?? null;
				const candidateRequest = requestForCandidate(
					resolved.request,
					cand,
					settings.unsupportedParameterStrategy,
					(result) => {
						parameterPolicy = result;
					},
				);
				return options?.execute
					? options.execute(cand, ctx, candidateRequest)
					: executeChat(cand.adapter, candidateRequest, ctx);
			},
		);
	let routing = await runRoute();
	while (routing.value.kind === "stream") {
		const iterator = routing.value.chunks[Symbol.asyncIterator]();
		const buffered = [];
		try {
			while (true) {
				const next = await iterator.next();
				if (next.done) {
					break;
				}
				buffered.push(next.value);
				const semantic = chatChunkSemantic(next.value);
				const terminal = next.value.choices.some(
					(choice) => choice.finishReason !== null,
				);
				if (
					semantic === "reasoning" ||
					semantic === "content" ||
					semantic === "tool" ||
					terminal
				) {
					const remaining = iterator;
					const prefetched = buffered;
					routing.value = {
						...routing.value,
						chunks: (async function* () {
							yield* prefetched;
							while (true) {
								const item = await remaining.next();
								if (item.done) {
									return;
								}
								yield item.value;
							}
						})(),
					};
					routing.attempts += failedAttempts;
					routing.fallbackUsed ||= usedFallback;
					routing.attemptLog.unshift(...failedAttemptLog);
					return { routing, parameterPolicy, contentInputResolution };
				}
			}
			throw new GatewayError({
				class: "server",
				code: "upstream_protocol_error",
				message: "Upstream stream ended before a semantic terminal",
				failureKind: "transient",
				deploymentHealth: "penalize",
			});
		} catch (error) {
			const streamError = GatewayError.is(error)
				? error
				: new GatewayError({
						class: "server",
						message: "Unexpected error while awaiting upstream output",
						failureKind: "gateway",
						deploymentHealth: "neutral",
						retryable: false,
						cause: error,
					});
			await Promise.allSettled([
				routing.finish(null, Date.now(), streamError),
				iterator.return?.(),
			]);
			failedAttemptLog.push(...routing.attemptLog);
			failedAttempts += routing.attempts;
			usedFallback ||= routing.fallbackUsed;
			remainingAttempts = policy.maxAttempts - failedAttempts;
			previouslyFailed.add(routing.candidate.row.id);
			if (
				!streamError.retryable ||
				streamError.routingScope === "request" ||
				(options?.signal ?? c.req.raw.signal).aborted ||
				remainingAttempts <= 0 ||
				Date.now() >= preOutputDeadlineAt
			) {
				streamError.attempts = failedAttemptLog;
				throw streamError;
			}
			try {
				routing = await runRoute();
			} catch (retryError) {
				// The re-entry reports only its own attempts (often none, when every deployment is in
				// cooldown). Without this merge the attempts that actually failed are dropped from the
				// operation, which is what hides the real cause behind a bare "after 0 attempts".
				if (GatewayError.is(retryError)) {
					retryError.attempts = [
						...failedAttemptLog,
						...((retryError.attempts as typeof failedAttemptLog) ?? []),
					];
				}
				throw retryError;
			}
		}
	}
	return { routing, parameterPolicy, contentInputResolution };
}

export function parameterPolicyLogMetadata(
	result: ParameterPolicyResult | null,
	strategy: UnsupportedParameterStrategy,
): Record<string, unknown> | undefined {
	if (!result || result.droppedParameters.length === 0) {
		return undefined;
	}
	return {
		strategy,
		droppedParameters: result.droppedParameters,
	};
}

export function contentInputResolutionLogMetadata(
	result: ContentInputResolutionMetadata | null,
): Record<string, unknown> | undefined {
	if (!result) {
		return undefined;
	}
	return {
		pdfEngine: result.pdfEngine,
		nativeFiles: result.nativeFiles,
		parsedFiles: result.parsedFiles,
		materializedFiles: result.materializedFiles,
		nativeImages: result.nativeImages,
		materializedImages: result.materializedImages,
	};
}
