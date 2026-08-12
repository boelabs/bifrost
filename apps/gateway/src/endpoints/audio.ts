import { assertTranscriptionRequestSupported } from "#gateway/transcriptionRequestValidation.ts";
import { estimateTokenReservation } from "#router/tokenReservation.ts";
import { parseTranscriptionMultipart } from "#audio/multipart.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import { route, type RouteResult } from "#router/index.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";

import {
	applyCanonicalResponseExtensions,
	applyCanonicalRequestExtensions,
	applyStreamEventExtensions,
	assertFinalModelAllowed,
	notifyExtensionError,
	usageQuotaForRequest,
	computeUsageCost,
	toGatewayError,
	preflight,
} from "./runtime/pipeline.ts";

import {
	type CanonicalTranscriptionRequest,
	TEXT_TRANSCRIPTION_FORMATS,
	transcriptionUsageToCore,
	type TranscriptionUsage,
} from "#core/audio.ts";

import {
	type DownstreamWriteObservation,
	newDownstreamWriteObservation,
	withSSEHeartbeats,
	writeSSEHeartbeat,
	writeSSE,
} from "./runtime/sse.ts";

import {
	toOpenAITranscriptionResponse,
	toOpenAITranscriptionEvent,
	transcriptionToCanonical,
} from "#contracts/openai/audio.ts";

import {
	type TranscriptionExecResult,
	executeTranscription,
} from "#gateway/executor.ts";

type Cleanup = () => Promise<void>;

function responseLog(
	format: CanonicalTranscriptionRequest["responseFormat"],
	text: string,
): Record<string, unknown> {
	return TEXT_TRANSCRIPTION_FORMATS.includes(format)
		? { format, chars: text.length }
		: { format, text };
}

async function handleTranscription(
	c: Context<AppEnv>,
	inputReq: CanonicalTranscriptionRequest,
	requestBody: unknown,
	cleanup: Cleanup,
): Promise<Response> {
	let req = inputReq;
	const log = new OperationLogDraft(c, "audio.transcriptions", {
		publicModel: req.model,
	});
	log.requestBody = requestBody;

	let routing: RouteResult<TranscriptionExecResult> | null = null;
	let fallbackUsage: ReturnType<typeof transcriptionUsageToCore> = null;
	let finished = false;
	let cleanupDeferred = false;

	const finish = async (
		usage: ReturnType<typeof transcriptionUsageToCore>,
		error?: GatewayError | null,
		downstream?: DownstreamWriteObservation,
	): Promise<void> => {
		if (!routing || finished) return;
		finished = true;
		await routing.finish(
			usage ?? fallbackUsage,
			undefined,
			error,
			undefined,
			downstream,
		);
	};

	try {
		await preflight(c, req.model);
		req = await applyCanonicalRequestExtensions(c, "audio.transcriptions", req);
		log.publicModel = req.model;
		assertFinalModelAllowed(c, req.model);

		routing = await route(
			req.model,
			"audio.transcriptions",
			{
				clientSignal: log.clientSignal,
				requestId: log.requestId,
				operationId: log.operationId,
				executionMode: req.stream ? "stream" : "json",
				candidateEligibility: (candidate) =>
					assertTranscriptionRequestSupported(req, candidate.meta),
				tokenReservation: (candidate) =>
					estimateTokenReservation(req, {
						maxOutputTokens: candidate.meta.maxOutputTokens ?? 0,
					}),
				usageQuota: usageQuotaForRequest(c),
			},
			(candidate, ctx) => executeTranscription(candidate.adapter, req, ctx),
		);
		log.applyRouting(routing);
		if (routing.value.kind === "json")
			fallbackUsage = transcriptionUsageToCore(routing.value.response.usage);
		const meta = routing.candidate.meta;
		const metadata: Record<string, unknown> = {
			...candidateMetadata(routing.candidate),
			...(routing.value.kind === "stream"
				? { streamLifecycle: routing.value.observation }
				: { terminal: routing.value.terminal }),
		};

		if (routing.value.kind === "json") {
			log.upstreamTtftMs = Date.now() - routing.upstreamStartedAt;
			const response = await applyCanonicalResponseExtensions(
				c,
				"audio.transcriptions",
				req.model,
				routing.value.response,
			);
			const core = transcriptionUsageToCore(response.usage);
			const cost = computeUsageCost(meta, core);
			await finish(core);
			await cleanup();
			log.write({
				status: "success",
				httpStatus: 200,
				usage: core,
				cost,
				ttftMs: log.elapsedMs(),
				responseBody: responseLog(req.responseFormat, response.text),
				metadata,
				error: null,
			});
			const rendered = toOpenAITranscriptionResponse(
				response,
				req.responseFormat,
			);
			return typeof rendered === "string" ? c.text(rendered) : c.json(rendered);
		}

		const streamRouting = routing;
		const events = routing.value.events;
		cleanupDeferred = true;
		return streamSSE(c, async (stream) => {
			stream.onAbort(() => log.abortClient());
			const downstream = newDownstreamWriteObservation(log.operationId);
			let usage: TranscriptionUsage | undefined;
			let firstAt: number | null = null;
			let streamError: GatewayError | null = null;
			try {
				for await (const event of withSSEHeartbeats(events, () =>
					writeSSEHeartbeat(stream, downstream),
				)) {
					log.progress();
					const transformed = await applyStreamEventExtensions(
						c,
						"audio.transcriptions",
						req.model,
						event,
					);
					if (firstAt === null) {
						firstAt = Date.now();
						log.upstreamTtftMs = firstAt - streamRouting.upstreamStartedAt;
					}
					if (transformed.kind === "done" && transformed.usage)
						usage = transformed.usage;
					await writeSSE(
						stream,
						{
							data: JSON.stringify(toOpenAITranscriptionEvent(transformed)),
						},
						downstream,
					);
				}
			} catch (error) {
				streamError = GatewayError.is(error)
					? error
					: new GatewayError({
							class: "server",
							message: "Transcription stream failed",
							cause: error,
						});
				await notifyExtensionError(
					c,
					"audio.transcriptions",
					req.model,
					streamError,
				);
				if (streamError.code !== "downstream_backpressure")
					await writeSSE(
						stream,
						{
							data: JSON.stringify(streamError.toOpenAI()),
						},
						downstream,
					);
			} finally {
				const core = transcriptionUsageToCore(usage);
				const cost = computeUsageCost(streamRouting.candidate.meta, core);
				await finish(core, streamError, downstream);
				await cleanup();
				log.write({
					status: streamError ? "error" : "success",
					httpStatus: 200,
					usage: core,
					cost,
					ttftMs: firstAt ? firstAt - log.startedAt : null,
					responseBody: { streamed: true },
					metadata,
					error: streamError?.toLog() ?? null,
				});
			}
		});
	} catch (error) {
		const ge = toGatewayError(error);
		log.applyFailedAttempts(ge.attempts);
		await finish(null, ge);
		await notifyExtensionError(c, "audio.transcriptions", log.publicModel, ge);
		if (!cleanupDeferred) await cleanup();
		log.writeError(ge);
		throw ge;
	}
}

export async function transcriptionsHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const multipart = await parseTranscriptionMultipart(c.req.raw);
	return handleTranscription(
		c,
		transcriptionToCanonical(multipart.fields, multipart.file),
		multipart.logBody,
		multipart.cleanup,
	);
}
