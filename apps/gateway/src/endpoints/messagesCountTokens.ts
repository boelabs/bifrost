import { estimateMessagesInputTokens } from "#contracts/anthropic/messagesTokenCount.ts";
import { messagesRequestToCanonical } from "#contracts/anthropic/messagesRender.ts";
import { listDeploymentCandidates } from "#gateway/deploymentCandidates.ts";
import type { MessageTokenCountResponse } from "#adapters/types.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { executeMessageTokenCount } from "#gateway/executor.ts";
import { completedTerminal } from "#gateway/streamLifecycle.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import { route, type RouteResult } from "#router/index.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Context } from "hono";

import {
	PUBLIC_JSON_BODY_MAX_BYTES,
	notifyExtensionError,
	toGatewayError,
	readJsonBody,
	parseBody,
	preflight,
} from "./runtime/pipeline.ts";

import {
	messagesTokenCountRequestSchema,
	messagesRequestSchema,
} from "#contracts/anthropic/messages.ts";

/** POST /v1/messages/count_tokens - native when available, deterministic portable fallback otherwise. */
export async function messagesCountTokensHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const log = new OperationLogDraft(c, "messages.count_tokens");
	let routing: RouteResult<MessageTokenCountResponse> | null = null;
	let finished = false;

	const finish = async (error?: GatewayError | null): Promise<void> => {
		if (!routing || finished) return;
		finished = true;
		await routing.finish(
			null,
			undefined,
			error,
			error ? null : completedTerminal(),
		);
	};

	try {
		const json = await readJsonBody(c, PUBLIC_JSON_BODY_MAX_BYTES);
		log.requestBody = json;
		const parsed = parseBody(messagesTokenCountRequestSchema, json);
		log.publicModel = parsed.model;
		await preflight(c, parsed.model);
		const canonical = messagesRequestToCanonical(
			messagesRequestSchema.parse({
				...parsed,
				max_tokens: 1,
				stream: false,
			}),
		);
		const candidates = await listDeploymentCandidates(canonical.model, "chat");
		if (candidates.length === 0) {
			throw new GatewayError({
				class: "not_found",
				code: "model_not_found",
				message: `Public model "${canonical.model}" does not exist or has no enabled chat deployments`,
			});
		}

		let response: { input_tokens: number };
		let metadata: Record<string, unknown>;
		if (candidates.some((candidate) => candidate.adapter.messageTokenCount)) {
			routing = await route(
				canonical.model,
				"chat",
				{
					clientSignal: log.clientSignal,
					requestId: log.requestId,
					operationId: log.operationId,
					preferredTransport: "messages",
					candidateEligibility: (candidate) => {
						if (!candidate.adapter.messageTokenCount)
							throw new GatewayError({
								class: "bad_request",
								code: "native_token_count_unsupported",
								message: `Adapter "${candidate.adapter.key}" has no native Messages token counter`,
								deploymentHealth: "neutral",
							});
					},
				},
				(candidate, ctx) =>
					executeMessageTokenCount(
						candidate.adapter,
						{
							canonical,
							rawBody: parsed as unknown as Record<string, unknown>,
						},
						ctx,
					),
			);
			log.applyRouting(routing);
			log.upstreamTtftMs = Date.now() - routing.upstreamStartedAt;
			response = { input_tokens: routing.value.inputTokens };
			metadata = {
				...candidateMetadata(routing.candidate),
				tokenCount: { mode: "native" },
			};
			await finish();
		} else {
			response = { input_tokens: estimateMessagesInputTokens(parsed) };
			metadata = { tokenCount: { mode: "estimated" } };
		}

		log.write({
			status: "success",
			httpStatus: 200,
			usage: null,
			cost: null,
			ttftMs: log.elapsedMs(),
			responseBody: response,
			metadata,
			error: null,
		});
		return c.json(response);
	} catch (error) {
		const ge = toGatewayError(error);
		log.applyFailedAttempts(ge.attempts);
		await finish(ge);
		await notifyExtensionError(c, "chat", log.publicModel, ge);
		log.writeError(ge);
		throw ge;
	}
}
