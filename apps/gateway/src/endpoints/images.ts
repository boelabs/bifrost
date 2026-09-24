import { assertImageRequestSupported } from "#gateway/imageRequestValidation.ts";
import { executeImage, type ImageExecResult } from "#gateway/executor.ts";
import { estimateTokenReservation } from "#router/tokenReservation.ts";
import { withResolvedQuality } from "#gateway/qualityResolution.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import { parseImageEditMultipart } from "#images/multipart.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
import { getEffectiveSettings } from "#router/settings.ts";
import { route, type RouteResult } from "#router/index.ts";
import { imageResponseLog } from "#images/logging.ts";
import { imageProfileFor } from "#catalog/types.ts";
import { imageUsageToCore } from "#core/images.ts";
import { GatewayError } from "#core/errors.ts";
import type { AppEnv } from "#auth/types.ts";
import { streamSSE } from "hono/streaming";
import type { Context } from "hono";

import {
	applyCanonicalResponseExtensions,
	applyCanonicalRequestExtensions,
	applyStreamEventExtensions,
	applyImageOutputExtensions,
	PUBLIC_JSON_BODY_MAX_BYTES,
	assertFinalModelAllowed,
	notifyExtensionError,
	usageQuotaForRequest,
	computeUsageCost,
	toGatewayError,
	extensionScope,
	readJsonBody,
	parseBody,
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
	imageGenerationRequestSchema,
	toOpenAIImagesResponse,
	generationToCanonical,
	toOpenAIImageEvent,
	editToCanonical,
} from "#contracts/openai/images.ts";

import type {
	CanonicalImageStreamEvent,
	CanonicalImageResponse,
	CanonicalImageRequest,
} from "#core/images.ts";

import {
	transformImageResponse,
	transformImageEvent,
} from "#images/transform.ts";

type Cleanup = () => Promise<void>;

async function handleImageRequest(
	c: Context<AppEnv>,
	inputReq: CanonicalImageRequest,
	requestBody: unknown,
	cleanup?: Cleanup,
): Promise<Response> {
	let req = inputReq;
	const callType =
		req.operation === "generation"
			? ("images.generations" as const)
			: ("images.edits" as const);
	const log = new OperationLogDraft(c, callType, { publicModel: req.model });
	log.requestBody = requestBody;

	let routing: RouteResult<ImageExecResult> | null = null;
	let fallbackUsage: ReturnType<typeof imageUsageToCore> = null;
	let finished = false;
	let cleanupDeferred = false;

	const finish = async (
		usage: ReturnType<typeof imageUsageToCore>,
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
		req = await applyCanonicalRequestExtensions(c, callType, req);
		log.publicModel = req.model;
		assertFinalModelAllowed(c, req.model);
		const { unsupportedParameterStrategy } = await getEffectiveSettings();
		/** Set when the served model's ladder could not honor the rung the client asked for. */
		let qualityAdjustment: { from: string; to: string | null } | undefined;
		/** The rung sent to the served model, reported when the provider does not echo one. */
		let sentQuality: CanonicalImageResponse["quality"];
		/** The rung this model will actually be asked for, reconciled per candidate. */
		const forCandidate = (candidate: { meta: ResolvedModelMetadata }) =>
			withResolvedQuality(
				req,
				imageProfileFor(candidate.meta, req.operation)?.qualities,
				unsupportedParameterStrategy,
			);
		const imageScope = extensionScope(c, callType, req.model);
		const imageHooks = {
			applyImageOutput: (
				output: Parameters<typeof applyImageOutputExtensions>[1],
			) => applyImageOutputExtensions(imageScope, output),
		};

		const routeImage = async (): Promise<RouteResult<ImageExecResult>> => {
			const routed = await route(
				req.model,
				callType,
				{
					clientSignal: log.clientSignal,
					requestId: log.requestId,
					operationId: log.operationId,
					executionMode: req.stream ? "stream" : "json",
					candidateEligibility: (candidate) =>
						assertImageRequestSupported(
							req,
							candidate.meta,
							unsupportedParameterStrategy,
						),
					tokenReservation: (candidate) =>
						estimateTokenReservation(req, {
							maxOutputTokens: candidate.meta.maxOutputTokens ?? 0,
						}),
					usageQuota: usageQuotaForRequest(c),
				},
				(candidate, ctx) => {
					const { request, resolved } = forCandidate(candidate);
					sentQuality = resolved.quality;
					qualityAdjustment =
						resolved.adjustedFrom === undefined
							? undefined
							: { from: resolved.adjustedFrom, to: resolved.quality ?? null };
					return executeImage(candidate.adapter, request, ctx);
				},
			);
			routing = routed;
			log.applyRouting(routed);
			if (routed.value.kind === "json") {
				fallbackUsage = imageUsageToCore(routed.value.response.usage);
			}
			return routed;
		};
		const routeMetadata = (
			routed: RouteResult<ImageExecResult>,
		): Record<string, unknown> => ({
			...candidateMetadata(routed.candidate),
			...(qualityAdjustment === undefined ? {} : { qualityAdjustment }),
			...(routed.value.kind === "stream"
				? { streamLifecycle: routed.value.observation }
				: { terminal: routed.value.terminal }),
		});
		const jsonResponse = async (
			routed: RouteResult<ImageExecResult>,
			response: CanonicalImageResponse,
		) => {
			log.upstreamTtftMs = Date.now() - routed.upstreamStartedAt;
			const reported =
				response.quality === undefined && sentQuality !== undefined
					? { ...response, quality: sentQuality }
					: response;
			return transformImageResponse(
				await applyCanonicalResponseExtensions(
					c,
					callType,
					req.model,
					reported,
				),
				req,
				imageProfileFor(routed.candidate.meta, req.operation),
				imageHooks,
			);
		};

		if (!req.stream) {
			const routed = await routeImage();
			if (routed.value.kind !== "json") {
				throw new GatewayError({
					class: "server",
					message: "Non-streaming image request unexpectedly returned a stream",
				});
			}
			const response = await jsonResponse(routed, routed.value.response);
			const usage = imageUsageToCore(response.usage);
			await finish(usage);
			await cleanup?.();
			log.write({
				status: "success",
				httpStatus: 200,
				usage,
				cost: computeUsageCost(routed.candidate.meta, usage),
				firstOutputMs: null,
				responseBody: imageResponseLog(response),
				metadata: routeMetadata(routed),
				error: null,
			});
			return c.json(toOpenAIImagesResponse(response));
		}

		cleanupDeferred = true;
		return streamSSE(c, async (stream) => {
			stream.onAbort(() => log.abortClient());
			const downstream = newDownstreamWriteObservation(log.operationId);
			const metadata: Record<string, unknown> = { downstream };
			let usage: ReturnType<typeof imageUsageToCore> = null;
			let responseBody: Record<string, unknown> | null = null;
			let count = 0;
			let firstAt: number | null = null;
			let streamError: GatewayError | null = null;
			try {
				// Force headers onto the wire before upstream routing can stall: a JSON upstream serving
				// a streaming request generates the whole image inside routing.
				await writeSSEHeartbeat(stream, downstream);
				const routed = await awaitWithSSEHeartbeats(routeImage(), () =>
					writeSSEHeartbeat(stream, downstream),
				);
				Object.assign(metadata, routeMetadata(routed));

				if (routed.value.kind === "json") {
					const response = await jsonResponse(routed, routed.value.response);
					usage = imageUsageToCore(response.usage);
					responseBody = imageResponseLog(response);
					const [completedImage] = response.data;
					if (response.data.length !== 1 || !completedImage) {
						throw new GatewayError({
							class: "server",
							message: `Non-streaming image upstream returned ${response.data.length} outputs for a streaming request; expected exactly one`,
						});
					}
					const event: CanonicalImageStreamEvent = {
						kind: "completed",
						operation: req.operation,
						image: completedImage,
						createdAt: response.created,
						...(response.background ? { background: response.background } : {}),
						...(response.outputFormat
							? { outputFormat: response.outputFormat }
							: {}),
						...(response.quality ? { quality: response.quality } : {}),
						...(response.size ? { size: response.size } : {}),
						...(response.usage ? { usage: response.usage } : {}),
					};
					const transformed = await applyStreamEventExtensions(
						c,
						callType,
						req.model,
						event,
					);
					await writeSSE(
						stream,
						{
							data: JSON.stringify(toOpenAIImageEvent(transformed)),
						},
						downstream,
					);
				} else {
					const profile = imageProfileFor(routed.candidate.meta, req.operation);
					for await (const rawEvent of withSSEHeartbeats(
						routed.value.events,
						() => writeSSEHeartbeat(stream, downstream),
					)) {
						log.progress();
						const canonicalEvent = await applyStreamEventExtensions(
							c,
							callType,
							req.model,
							rawEvent,
						);
						const event = await transformImageEvent(
							canonicalEvent,
							req,
							profile,
							imageHooks,
						);
						if (firstAt === null) {
							firstAt = Date.now();
							log.upstreamTtftMs = firstAt - routed.upstreamStartedAt;
						}
						if (event.kind === "completed" && event.usage) {
							usage = imageUsageToCore(event.usage);
						}
						count += 1;
						await writeSSE(
							stream,
							{
								data: JSON.stringify(toOpenAIImageEvent(event)),
							},
							downstream,
						);
					}
				}
			} catch (error) {
				streamError = toGatewayError(error, "Image stream failed");
				log.applyFailedAttempts(streamError.attempts);
				await notifyExtensionError(c, callType, req.model, streamError);
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
				if (routing) {
					await finish(usage, streamError, downstream);
				} else {
					finishDownstreamWriteObservation(downstream, streamError?.code);
				}
				await cleanup?.();
				log.write({
					status: streamError ? "error" : "success",
					httpStatus: 200,
					usage,
					cost: routing
						? computeUsageCost(routing.candidate.meta, usage)
						: null,
					firstOutputMs: firstAt ? firstAt - log.startedAt : null,
					responseBody: responseBody ?? { streamed: true, events: count },
					metadata,
					error: streamError?.toLog() ?? null,
				});
			}
		});
	} catch (error) {
		const ge = toGatewayError(error);
		log.applyFailedAttempts(ge.attempts);
		await finish(null, ge);
		await notifyExtensionError(c, callType, log.publicModel, ge);
		if (!cleanupDeferred) {
			await cleanup?.();
		}
		log.writeError(ge);
		throw ge;
	}
}

export async function imageGenerationsHandler(
	c: Context<AppEnv>,
): Promise<Response> {
	const json = await readJsonBody(c, PUBLIC_JSON_BODY_MAX_BYTES);
	const data = parseBody(imageGenerationRequestSchema, json);
	return handleImageRequest(c, generationToCanonical(data), data);
}

export async function imageEditsHandler(c: Context<AppEnv>): Promise<Response> {
	const multipart = await parseImageEditMultipart(c.req.raw);
	return handleImageRequest(
		c,
		editToCanonical(multipart.fields, multipart.images, multipart.mask),
		multipart.logBody,
		multipart.cleanup,
	);
}
