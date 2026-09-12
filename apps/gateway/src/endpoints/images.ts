import { assertImageRequestSupported } from "#gateway/imageRequestValidation.ts";
import { executeImage, type ImageExecResult } from "#gateway/executor.ts";
import { estimateTokenReservation } from "#router/tokenReservation.ts";
import { candidateMetadata } from "#gateway/candidateMetadata.ts";
import { parseImageEditMultipart } from "#images/multipart.ts";
import { OperationLogDraft } from "./runtime/operationLog.ts";
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
	imageGenerationRequestSchema,
	toOpenAIImagesResponse,
	generationToCanonical,
	toOpenAIImageEvent,
	editToCanonical,
} from "#contracts/openai/images.ts";

import {
	type DownstreamWriteObservation,
	newDownstreamWriteObservation,
	withSSEHeartbeats,
	writeSSEHeartbeat,
	writeSSE,
} from "./runtime/sse.ts";

import type {
	CanonicalImageStreamEvent,
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
		req = await applyCanonicalRequestExtensions(c, callType, req);
		log.publicModel = req.model;
		assertFinalModelAllowed(c, req.model);

		routing = await route(
			req.model,
			callType,
			{
				clientSignal: log.clientSignal,
				requestId: log.requestId,
				operationId: log.operationId,
				executionMode: req.stream ? "stream" : "json",
				candidateEligibility: (candidate) =>
					assertImageRequestSupported(req, candidate.meta),
				tokenReservation: (candidate) =>
					estimateTokenReservation(req, {
						maxOutputTokens: candidate.meta.maxOutputTokens ?? 0,
					}),
				usageQuota: usageQuotaForRequest(c),
			},
			(candidate, ctx) => executeImage(candidate.adapter, req, ctx),
		);
		log.applyRouting(routing);
		if (routing.value.kind === "json")
			fallbackUsage = imageUsageToCore(routing.value.response.usage);
		const metadata: Record<string, unknown> = {
			...candidateMetadata(routing.candidate),
			...(routing.value.kind === "stream"
				? { streamLifecycle: routing.value.observation }
				: { terminal: routing.value.terminal }),
		};
		const imageScope = extensionScope(c, callType, req.model);
		const imageHooks = {
			applyImageOutput: (
				output: Parameters<typeof applyImageOutputExtensions>[1],
			) => applyImageOutputExtensions(imageScope, output),
		};

		if (routing.value.kind === "json") {
			log.upstreamTtftMs = Date.now() - routing.upstreamStartedAt;
			const transformedResponse = await transformImageResponse(
				await applyCanonicalResponseExtensions(
					c,
					callType,
					req.model,
					routing.value.response,
				),
				req,
				imageProfileFor(routing.candidate.meta, req.operation),
				imageHooks,
			);
			const response = transformedResponse;
			const usage = imageUsageToCore(response.usage);
			const cost = computeUsageCost(routing.candidate.meta, usage);

			if (!req.stream) {
				await finish(usage);
				await cleanup?.();
				log.write({
					status: "success",
					httpStatus: 200,
					usage,
					cost,
					ttftMs: log.elapsedMs(),
					responseBody: imageResponseLog(response),
					metadata,
					error: null,
				});
				return c.json(toOpenAIImagesResponse(response));
			}

			if (response.data.length !== 1) {
				throw new GatewayError({
					class: "server",
					message: `Non-streaming image upstream returned ${response.data.length} outputs for a streaming request; expected exactly one`,
				});
			}
			const completedImage = response.data[0];
			if (!completedImage) {
				throw new GatewayError({
					class: "server",
					message: "Image upstream returned no output",
				});
			}
			cleanupDeferred = true;
			return streamSSE(c, async (stream) => {
				stream.onAbort(() => log.abortClient());
				const downstream = newDownstreamWriteObservation(log.operationId);
				metadata.downstream = downstream;
				let streamError: GatewayError | null = null;
				try {
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
				} catch (error) {
					streamError = GatewayError.is(error)
						? error
						: new GatewayError({
								class: "server",
								message: "Image stream failed",
								cause: error,
							});
					await notifyExtensionError(c, callType, req.model, streamError);
					if (streamError.code !== "downstream_backpressure")
						await writeSSE(
							stream,
							{
								data: JSON.stringify(streamError.toOpenAI()),
							},
							downstream,
						);
				} finally {
					await finish(usage, streamError, downstream);
					await cleanup?.();
					log.write({
						status: streamError ? "error" : "success",
						httpStatus: 200,
						usage,
						cost,
						ttftMs: log.elapsedMs(),
						responseBody: imageResponseLog(response),
						metadata,
						error: streamError?.toLog() ?? null,
					});
				}
			});
		}

		const streamRouting = routing;
		const nativeValue = streamRouting.value;
		if (nativeValue.kind !== "stream") {
			throw new GatewayError({
				class: "server",
				message: "Invalid native image stream result",
			});
		}
		const nativeEvents = nativeValue.events;
		cleanupDeferred = true;
		return streamSSE(c, async (stream) => {
			stream.onAbort(() => log.abortClient());
			const downstream = newDownstreamWriteObservation(log.operationId);
			let usage: ReturnType<typeof imageUsageToCore> = null;
			let count = 0;
			let firstAt: number | null = null;
			let streamError: GatewayError | null = null;
			try {
				for await (const rawEvent of withSSEHeartbeats(nativeEvents, () =>
					writeSSEHeartbeat(stream, downstream),
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
						imageProfileFor(streamRouting.candidate.meta, req.operation),
						imageHooks,
					);
					if (firstAt === null) {
						firstAt = Date.now();
						log.upstreamTtftMs = firstAt - streamRouting.upstreamStartedAt;
					}
					if (event.kind === "completed" && event.usage)
						usage = imageUsageToCore(event.usage);
					count += 1;
					await writeSSE(
						stream,
						{
							data: JSON.stringify(toOpenAIImageEvent(event)),
						},
						downstream,
					);
				}
			} catch (error) {
				streamError = GatewayError.is(error)
					? error
					: new GatewayError({
							class: "server",
							message: "Image stream failed",
							cause: error,
						});
				await notifyExtensionError(c, callType, req.model, streamError);
				if (streamError.code !== "downstream_backpressure")
					await writeSSE(
						stream,
						{
							data: JSON.stringify(streamError.toOpenAI()),
						},
						downstream,
					);
			} finally {
				await finish(usage, streamError, downstream);
				const cost = computeUsageCost(streamRouting.candidate.meta, usage);
				await cleanup?.();
				log.write({
					status: streamError ? "error" : "success",
					httpStatus: 200,
					usage,
					cost,
					ttftMs: firstAt ? firstAt - log.startedAt : null,
					responseBody: { streamed: true, events: count },
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
		if (!cleanupDeferred) await cleanup?.();
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
