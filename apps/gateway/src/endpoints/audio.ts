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
	finishDownstreamWriteObservation,
	type DownstreamWriteObservation,
	newDownstreamWriteObservation,
	awaitWithSSEHeartbeats,
	withSSEHeartbeats,
	writeSSEHeartbeat,
	writeSSE,
} from "./runtime/sse.ts";

import {
	type CanonicalTranscriptionStreamEvent,
	type CanonicalTranscriptionRequest,
	TEXT_TRANSCRIPTION_FORMATS,
	transcriptionUsageToCore,
	type TranscriptionUsage,
} from "#core/audio.ts";

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
		if (!routing || finished) {
			return;
		}
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

		const routeTranscription = async (): Promise<
			RouteResult<TranscriptionExecResult>
		> => {
			const routed = await route(
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
			routing = routed;
			log.applyRouting(routed);
			if (routed.value.kind === "json") {
				fallbackUsage = transcriptionUsageToCore(routed.value.response.usage);
			}
			return routed;
		};
		const routeMetadata = (
			routed: RouteResult<TranscriptionExecResult>,
		): Record<string, unknown> => ({
			...candidateMetadata(routed.candidate),
			...(routed.value.kind === "stream"
				? { streamLifecycle: routed.value.observation }
				: { terminal: routed.value.terminal }),
		});

		if (!req.stream) {
			const routed = await routeTranscription();
			if (routed.value.kind !== "json") {
				throw new GatewayError({
					class: "server",
					message: "Non-streaming transcription unexpectedly returned a stream",
				});
			}
			log.upstreamTtftMs = Date.now() - routed.upstreamStartedAt;
			const response = await applyCanonicalResponseExtensions(
				c,
				"audio.transcriptions",
				req.model,
				routed.value.response,
			);
			const core = transcriptionUsageToCore(response.usage);
			const cost = computeUsageCost(routed.candidate.meta, core);
			await finish(core);
			await cleanup();
			log.write({
				status: "success",
				httpStatus: 200,
				usage: core,
				cost,
				firstOutputMs: null,
				responseBody: responseLog(req.responseFormat, response.text),
				metadata: routeMetadata(routed),
				error: null,
			});
			const rendered = toOpenAITranscriptionResponse(
				response,
				req.responseFormat,
			);
			return typeof rendered === "string" ? c.text(rendered) : c.json(rendered);
		}

		cleanupDeferred = true;
		return streamSSE(c, async (stream) => {
			stream.onAbort(() => log.abortClient());
			const downstream = newDownstreamWriteObservation(log.operationId);
			const metadata: Record<string, unknown> = {};
			let usage: TranscriptionUsage | undefined;
			let firstAt: number | null = null;
			let streamError: GatewayError | null = null;
			try {
				// Force headers onto the wire before upstream routing can stall.
				await writeSSEHeartbeat(stream, downstream);
				const routed = await awaitWithSSEHeartbeats(routeTranscription(), () =>
					writeSSEHeartbeat(stream, downstream),
				);
				Object.assign(metadata, routeMetadata(routed));
				const { value } = routed;
				const events: AsyncIterable<CanonicalTranscriptionStreamEvent> =
					value.kind === "stream"
						? value.events
						: (async function* () {
								// A JSON upstream serving a streaming request: its result is the terminal event.
								const { response } = value;
								yield {
									kind: "done",
									text: response.text,
									...(response.languages
										? { languages: response.languages }
										: {}),
									...(response.usage ? { usage: response.usage } : {}),
									...(response.logprobs === undefined
										? {}
										: { logprobs: response.logprobs }),
								};
							})();
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
						log.upstreamTtftMs = firstAt - routed.upstreamStartedAt;
					}
					if (transformed.kind === "done" && transformed.usage) {
						({ usage } = transformed);
					}
					await writeSSE(
						stream,
						{
							data: JSON.stringify(toOpenAITranscriptionEvent(transformed)),
						},
						downstream,
					);
				}
			} catch (error) {
				streamError = toGatewayError(error, "Transcription stream failed");
				log.applyFailedAttempts(streamError.attempts);
				await notifyExtensionError(
					c,
					"audio.transcriptions",
					req.model,
					streamError,
				);
				if (streamError.code !== "downstream_backpressure") {
					try {
						await writeSSE(
							stream,
							{
								data: JSON.stringify(streamError.toOpenAI()),
							},
							downstream,
						);
					} catch {
						// The original stream failure remains authoritative.
					}
				}
			} finally {
				const core = transcriptionUsageToCore(usage);
				if (routing) {
					await finish(core, streamError, downstream);
				} else {
					finishDownstreamWriteObservation(downstream, streamError?.code);
				}
				await cleanup();
				log.write({
					status: streamError ? "error" : "success",
					httpStatus: 200,
					usage: core,
					cost: routing ? computeUsageCost(routing.candidate.meta, core) : null,
					firstOutputMs: firstAt ? firstAt - log.startedAt : null,
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
		if (!cleanupDeferred) {
			await cleanup();
		}
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
