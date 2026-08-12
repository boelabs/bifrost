import { assertRerankResponseValid } from "#gateway/rerankResponseValidation.ts";
import { estimateTokenReservation } from "#router/tokenReservation.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import type { RerankExecResult } from "#gateway/executor.ts";
import { route, type RouteResult } from "#router/index.ts";
import { executeRerank } from "#gateway/executor.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Usage } from "#core/usage.ts";
import type { Context } from "hono";

import {
	applyCanonicalResponseExtensions,
	applyCanonicalRequestExtensions,
	assertFinalModelAllowed,
	notifyExtensionError,
	usageQuotaForRequest,
	computeUsageCost,
	toGatewayError,
	readJsonBody,
	parseBody,
	preflight,
} from "./runtime/pipeline.ts";

import {
	toOpenRouterRerankResponse,
	rerankRequestToCanonical,
	rerankRequestSchema,
} from "#contracts/openrouter/rerank.ts";

import {
	assertRerankProviderSupported,
	assertRerankRequestSupported,
} from "#gateway/rerankRequestValidation.ts";

import {
	rerankResponseSummary,
	rerankRequestSummary,
} from "#rerank/logging.ts";

export const MAX_RERANK_BODY_BYTES = 16 * 1024 * 1024;

/** POST /v1/rerank - OpenRouter-shaped text reranking contract. */
export async function rerankHandler(c: Context<AppEnv>): Promise<Response> {
	const log = new OperationLogDraft(c, "rerank");
	let routing: RouteResult<RerankExecResult> | null = null;
	let fallbackUsage: Usage | null = null;
	let finished = false;

	const finish = async (
		usage: Usage | null,
		error?: ReturnType<typeof toGatewayError> | null,
	): Promise<void> => {
		if (!routing || finished) return;
		finished = true;
		await routing.finish(usage ?? fallbackUsage, undefined, error);
	};

	try {
		const json = await readJsonBody(c, MAX_RERANK_BODY_BYTES);
		const parsed = parseBody(rerankRequestSchema, json);
		let canonical = rerankRequestToCanonical(parsed);
		log.publicModel = canonical.model;
		await preflight(c, canonical.model);
		canonical = await applyCanonicalRequestExtensions(c, "rerank", canonical);
		log.requestBody = rerankRequestSummary(canonical);
		log.publicModel = canonical.model;
		assertFinalModelAllowed(c, canonical.model);

		routing = await route(
			canonical.model,
			"rerank",
			{
				clientSignal: log.clientSignal,
				requestId: log.requestId,
				operationId: log.operationId,
				candidateEligibility: (candidate) => {
					assertRerankRequestSupported(canonical, candidate.meta);
					assertRerankProviderSupported(canonical, candidate.adapter);
				},
				tokenReservation: (candidate) =>
					estimateTokenReservation(canonical, {
						maxOutputTokens: candidate.meta.maxOutputTokens ?? 0,
					}),
				usageQuota: usageQuotaForRequest(c, {
					searchUnits: canonical.documents.length,
				}),
			},
			(candidate, ctx) => executeRerank(candidate.adapter, canonical, ctx),
		);
		log.applyRouting(routing);
		fallbackUsage = routing.value.response.usage ?? null;
		log.upstreamTtftMs = Date.now() - routing.upstreamStartedAt;

		const response = await applyCanonicalResponseExtensions(
			c,
			"rerank",
			canonical.model,
			routing.value.response,
		);
		assertRerankResponseValid(canonical, response);
		const usage = response.usage ?? null;
		await finish(usage);
		const cost = computeUsageCost(routing.candidate.meta, usage);
		const rendered = toOpenRouterRerankResponse(canonical, response, cost);
		log.write({
			status: "success",
			httpStatus: 200,
			usage,
			cost,
			ttftMs: log.elapsedMs(),
			responseBody: rerankResponseSummary(response, cost),
			metadata: {
				...candidateMetadata(routing.candidate),
				terminal: routing.value.terminal,
			},
			error: null,
		});
		return c.json(rendered);
	} catch (error) {
		const ge = toGatewayError(error);
		log.applyFailedAttempts(ge.attempts);
		await finish(null, ge);
		await notifyExtensionError(c, "rerank", log.publicModel, ge);
		log.writeError(ge);
		throw ge;
	}
}
