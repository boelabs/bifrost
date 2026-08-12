import { reserveVirtualKeyUsage, enforceVirtualKey } from "#ratelimit/index.ts";
import { getRequestId, setHeaders } from "#http/requestContext.ts";
import { buildCacheKey, cachePayload } from "#cache/cacheKey.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { OperationLogDraft } from "./operationLog.ts";
import { extensionRuntime } from "#extensions/runtime.ts";
import { assertModelAllowed } from "#auth/scope.ts";
import type { UsageQuota } from "#router/index.ts";
import type { CallType } from "#core/callType.ts";
import { GatewayError } from "#core/errors.ts";
import { getAuth } from "#auth/middleware.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Usage } from "#core/usage.ts";
import type { Context } from "hono";
import type * as z from "zod/v4";

import {
	estimateMaximumCostCents,
	type CostBreakdown,
	computeCost,
} from "#logging/cost.ts";

export {
	PUBLIC_JSON_BODY_MAX_BYTES,
	readJsonBody,
} from "#http/body.ts";

import type {
	ExtensionCanonicalResponse,
	ExtensionCanonicalRequest,
	ExtensionImageOutput,
	ExtensionStreamEvent,
	ExtensionPublicAuth,
} from "#extensions/sdk.ts";

import {
	responseCacheEpoch,
	cacheConfigFromHeaders,
	cacheGet,
	cacheSet,
} from "#cache/responseCache.ts";

/** Normalizes any thrown value to GatewayError (`server` class if it was not one already). */
export function toGatewayError(
	err: unknown,
	message = "Internal error",
): GatewayError {
	return GatewayError.is(err)
		? err
		: new GatewayError({
				class: "server",
				message,
				cause: err,
				failureKind: "gateway",
				deploymentHealth: "neutral",
				routingScope: "request",
			});
}

/** Translates a zod validation error to the `bad_request` GatewayError, with the issue detail. */
function zodToGatewayError(error: z.ZodError): GatewayError {
	const first = error.issues[0];
	return new GatewayError({
		class: "bad_request",
		message: error.issues
			.map((issue) =>
				issue.path.length
					? `${issue.path.join(".")}: ${issue.message}`
					: issue.message,
			)
			.join("; "),
		param: first ? first.path.join(".") : null,
	});
}

/** Validates `json` against a zod schema; throws `bad_request` with the detail if it does not pass. */
export function parseBody<T>(schema: z.ZodType<T>, json: unknown): T {
	const parsed = schema.safeParse(json);
	if (!parsed.success) throw zodToGatewayError(parsed.error);
	return parsed.data;
}

/**
 * Preflight common to every endpoint: validates the model scope and, if the key is virtual, applies
 * the rate limit and propagates its headers (x-ratelimit-*). Throws if the model is not allowed or a
 * limit is exceeded.
 */
export async function preflight(
	c: Context<AppEnv>,
	model: string,
	options?: { writeHeaders?: boolean },
): Promise<void> {
	const auth = getAuth(c);
	assertModelAllowed(auth, model);
	if (auth.type === "virtual") {
		const limited = await enforceVirtualKey(auth.key);
		if (options?.writeHeaders !== false) setHeaders(c, limited.headers);
	}
}

/** Re-checks model scope after trusted request extensions are allowed to rewrite the public model. */
export function assertFinalModelAllowed(
	c: Context<AppEnv>,
	model: string,
): void {
	assertModelAllowed(getAuth(c), model);
}

/** Builds a routed quota lifecycle for virtual keys; master-key requests need no reservation. */
export function usageQuotaForRequest(
	c: Context<AppEnv>,
	options: { searchUnits?: number } = {},
): UsageQuota {
	const auth = getAuth(c);
	if (auth.type !== "virtual") {
		return {
			assertCandidate: () => {},
			reserve: async () => ({
				settle: async () => {},
				release: async () => {},
			}),
		};
	}
	return {
		assertCandidate: (candidate) => {
			if (
				auth.key.maxBudgetCents != null &&
				estimateMaximumCostCents(candidate.meta, 0, options.searchUnits) ===
					null
			) {
				throw new GatewayError({
					class: "bad_request",
					code: "budget_pricing_unavailable",
					message: `Cannot enforce this API key's budget because deployment ${candidate.row.id} has no configured pricing`,
				});
			}
		},
		reserve: async (candidate, reservedTokens) => {
			const reservedCost =
				estimateMaximumCostCents(
					candidate.meta,
					reservedTokens,
					options.searchUnits,
				) ?? 0;
			const lease = await reserveVirtualKeyUsage(
				auth.key,
				reservedTokens,
				reservedCost,
			);
			return {
				settle: async (usage) => {
					const cost = computeCost(candidate.meta, usage);
					await lease.settle(usage.totalTokens, cost.totalCents);
				},
				release: () => lease.release(),
			};
		},
	};
}

export function extensionScope(
	c: Context<AppEnv>,
	callType: CallType,
	publicModel: string | null,
) {
	const auth = getAuth(c);
	const publicAuth: ExtensionPublicAuth =
		auth.type === "virtual"
			? {
					type: "virtual",
					virtualKeyId: auth.key.id,
					virtualKeyName: auth.key.name,
				}
			: { type: "master" };
	return {
		requestId: getRequestId(c),
		callType,
		endpoint: c.req.path,
		publicModel,
		auth: publicAuth,
		signal: c.get("turnSignal") ?? c.req.raw.signal,
	};
}

export async function applyCanonicalRequestExtensions<
	T extends ExtensionCanonicalRequest,
>(c: Context<AppEnv>, callType: CallType, request: T): Promise<T> {
	return extensionRuntime.runCanonicalRequest(
		extensionScope(c, callType, request.model),
		request,
	);
}

export async function applyCanonicalResponseExtensions<
	T extends ExtensionCanonicalResponse,
>(
	c: Context<AppEnv>,
	callType: CallType,
	publicModel: string | null,
	response: T,
): Promise<T> {
	return extensionRuntime.runCanonicalResponse(
		extensionScope(c, callType, publicModel),
		response,
	);
}

export async function applyStreamEventExtensions<
	T extends ExtensionStreamEvent,
>(
	c: Context<AppEnv>,
	callType: CallType,
	publicModel: string | null,
	event: T,
): Promise<T> {
	return extensionRuntime.runStreamEvent(
		extensionScope(c, callType, publicModel),
		event,
	);
}

export async function applyImageOutputExtensions(
	scope: ReturnType<typeof extensionScope>,
	output: ExtensionImageOutput,
): Promise<ExtensionImageOutput> {
	return extensionRuntime.runImageOutput(scope, output);
}

export async function notifyExtensionError(
	c: Context<AppEnv>,
	callType: CallType,
	publicModel: string | null,
	error: unknown,
): Promise<void> {
	try {
		await extensionRuntime.runErrorHooks(
			extensionScope(c, callType, publicModel),
			error,
		);
	} catch {
		// Error hooks are observability hooks; never replace the original request failure.
	}
}

/**
 * Computes the exact cost for logging/rendering. Routed virtual-key quota settlement already uses
 * the same pricing function, so this helper has no independent side effect.
 */
export function computeUsageCost(
	meta: Pick<ResolvedModelMetadata, "pricing">,
	usage: Usage | null,
): CostBreakdown | null {
	if (!usage) return null;
	const cost = computeCost(meta, usage);
	return cost;
}

/** Response-cache slot: on hit, `body` is the response to return; `store` persists on miss. */
export interface CacheSlot {
	hit: boolean;
	body: unknown;
	store(body: unknown, usage: Usage): void;
}

const NO_CACHE: CacheSlot = { hit: false, body: null, store: () => {} };

/**
 * Opt-in response cache for text endpoints (chat/responses/messages). Isolated per virtual key
 * -the MASTER never caches- and governed by the x-unified-cache headers. On a hit it logs the request
 * as `cacheHit` via the draft and returns the body to respond with; on a miss it returns a `store()`
 * that persists the final response. `eligible` captures the endpoint-specific conditions (no
 * stream, no tools, no server-side state...).
 */
export async function openResponseCache(opts: {
	c: Context<AppEnv>;
	draft: OperationLogDraft;
	namespace: string;
	payload: Record<string, unknown>;
	eligible: boolean;
	logBody?: (body: unknown) => unknown;
}): Promise<CacheSlot> {
	const auth = getAuth(opts.c);
	const cfg = cacheConfigFromHeaders((name) => opts.c.req.header(name));
	if (auth.type !== "virtual" || !cfg.enabled || !opts.eligible)
		return NO_CACHE;

	const epoch = await responseCacheEpoch();
	const key = buildCacheKey(opts.namespace, auth.key.id, {
		epoch,
		payload: cachePayload(opts.payload),
	});
	const cached = await cacheGet(key);
	if (cached) {
		opts.draft.writeCacheHit(
			cached.body,
			cached.usage,
			opts.logBody ? opts.logBody(cached.body) : cached.body,
		);
		return { hit: true, body: cached.body, store: () => {} };
	}
	return {
		hit: false,
		body: null,
		store: (body, usage) => void cacheSet(key, { body, usage }, cfg.ttlSeconds),
	};
}
