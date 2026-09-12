import { assertEmbeddingsRequestSupported } from "#gateway/embeddingsRequestValidation.ts";
import { estimateTokenReservation } from "#router/tokenReservation.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import type { EmbeddingsExecResult } from "#gateway/executor.ts";
import { embeddingsResponseLog } from "#embeddings/logging.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import { embeddingsUsageToCore } from "#core/embeddings.ts";
import { route, type RouteResult } from "#router/index.ts";
import { executeEmbeddings } from "#gateway/executor.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Context } from "hono";

import {
	applyCanonicalResponseExtensions,
	applyCanonicalRequestExtensions,
	PUBLIC_JSON_BODY_MAX_BYTES,
	assertFinalModelAllowed,
	notifyExtensionError,
	usageQuotaForRequest,
	openResponseCache,
	computeUsageCost,
	toGatewayError,
	readJsonBody,
	parseBody,
	preflight,
} from "./runtime/pipeline.ts";

import {
	embeddingsRequestToCanonical,
	toOpenAIEmbeddingsResponse,
	embeddingsRequestSchema,
} from "#contracts/openai/embeddings.ts";

/** POST /v1/embeddings - OpenAI-compatible contract, no-stream, cacheable. */
export async function embeddingsHandler(c: Context<AppEnv>): Promise<Response> {
	const log = new OperationLogDraft(c, "embeddings");
	let routing: RouteResult<EmbeddingsExecResult> | null = null;
	let fallbackUsage: ReturnType<typeof embeddingsUsageToCore> = null;
	let finished = false;

	const finish = async (
		usage: ReturnType<typeof embeddingsUsageToCore>,
		error?: ReturnType<typeof toGatewayError> | null,
	): Promise<void> => {
		if (!routing || finished) return;
		finished = true;
		await routing.finish(usage ?? fallbackUsage, undefined, error);
	};

	try {
		const json = await readJsonBody(c, PUBLIC_JSON_BODY_MAX_BYTES);
		log.requestBody = json;
		const parsed = parseBody(embeddingsRequestSchema, json);
		let canonical = embeddingsRequestToCanonical(parsed);
		log.publicModel = canonical.model;
		await preflight(c, canonical.model);
		canonical = await applyCanonicalRequestExtensions(
			c,
			"embeddings",
			canonical,
		);
		log.publicModel = canonical.model;
		assertFinalModelAllowed(c, canonical.model);

		const cache = await openResponseCache({
			c,
			draft: log,
			namespace: "embeddings",
			payload: canonical as unknown as Record<string, unknown>,
			eligible: true,
			logBody: embeddingsResponseLog,
		});
		if (cache.hit) return c.json(cache.body as object);

		routing = await route(
			canonical.model,
			"embeddings",
			{
				clientSignal: log.clientSignal,
				requestId: log.requestId,
				operationId: log.operationId,
				candidateEligibility: (candidate) =>
					assertEmbeddingsRequestSupported(canonical, candidate.meta),
				tokenReservation: (candidate) =>
					estimateTokenReservation(canonical, {
						maxOutputTokens: candidate.meta.maxOutputTokens ?? 0,
					}),
				usageQuota: usageQuotaForRequest(c),
			},
			(candidate, ctx) => executeEmbeddings(candidate.adapter, canonical, ctx),
		);
		log.applyRouting(routing);
		fallbackUsage = embeddingsUsageToCore(routing.value.response.usage);
		log.upstreamTtftMs = Date.now() - routing.upstreamStartedAt;

		const response = await applyCanonicalResponseExtensions(
			c,
			"embeddings",
			canonical.model,
			routing.value.response,
		);
		const usage = embeddingsUsageToCore(response.usage);
		await finish(usage);
		const cost = computeUsageCost(routing.candidate.meta, usage);
		const rendered = toOpenAIEmbeddingsResponse(response);
		if (usage) cache.store(rendered, usage);
		log.write({
			status: "success",
			httpStatus: 200,
			usage,
			cost,
			ttftMs: log.elapsedMs(),
			responseBody: embeddingsResponseLog(rendered),
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
		await notifyExtensionError(c, "embeddings", log.publicModel, ge);
		log.writeError(ge);
		throw ge;
	}
}
