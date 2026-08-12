import { assertRerankResponseValid } from "./rerankResponseValidation.ts";
import { assertTextRequestSupported } from "./textRequestValidation.ts";
import type { AdapterDiagnostics } from "#adapters/types.ts";
import { upstreamFetch } from "./instrumentedTransport.ts";
import { abortGatewayError } from "./abortReason.ts";
import { imageProfileFor } from "#catalog/types.ts";
import { GatewayError } from "#core/errors.ts";

import {
	observeTranscriptionStream,
	terminalForChatResponse,
	type CanonicalTerminal,
	type StreamObservation,
	observeImageStream,
	observeChatStream,
	completedTerminal,
} from "./streamLifecycle.ts";

import type {
	CanonicalTranscriptionStreamEvent,
	CanonicalTranscriptionResponse,
	CanonicalTranscriptionRequest,
} from "#core/audio.ts";

import type {
	CanonicalChatStreamChunk,
	CanonicalChatResponse,
	CanonicalChatRequest,
} from "#core/canonical.ts";

import type {
	CanonicalImageStreamEvent,
	CanonicalImageResponse,
	CanonicalImageRequest,
} from "#core/images.ts";

import type {
	CanonicalEmbeddingsResponse,
	CanonicalEmbeddingsRequest,
} from "#core/embeddings.ts";

import {
	finishOperationChildTelemetry,
	startOperationChildTelemetry,
} from "#telemetry/index.ts";

import {
	adapterContextDiagnostics,
	adapterDiagnostics,
} from "#adapters/diagnostics.ts";

import type {
	CanonicalRerankResponse,
	CanonicalRerankRequest,
} from "#core/rerank.ts";

import type {
	UpstreamHttpRequest,
	AdapterContext,
	Adapter,
} from "#adapters/types.ts";

export type ChatExecResult =
	| {
			kind: "json";
			response: CanonicalChatResponse;
			terminal: CanonicalTerminal;
			diagnostics?: AdapterDiagnostics;
	  }
	| {
			kind: "stream";
			chunks: AsyncIterable<CanonicalChatStreamChunk>;
			observation: StreamObservation;
			/** Private provider id used only to continue a gateway-owned WebSocket session. */
			upstreamResponseId?: Promise<string | null>;
	  };

export type ImageExecResult =
	| {
			kind: "json";
			response: CanonicalImageResponse;
			terminal: CanonicalTerminal;
			diagnostics: AdapterDiagnostics;
	  }
	| {
			kind: "stream";
			events: AsyncIterable<CanonicalImageStreamEvent>;
			observation: StreamObservation;
	  };

export type TranscriptionExecResult =
	| {
			kind: "json";
			response: CanonicalTranscriptionResponse;
			terminal: CanonicalTerminal;
			diagnostics: AdapterDiagnostics;
	  }
	| {
			kind: "stream";
			events: AsyncIterable<CanonicalTranscriptionStreamEvent>;
			observation: StreamObservation;
	  };

export type EmbeddingsExecResult = {
	kind: "json";
	response: CanonicalEmbeddingsResponse;
	terminal: CanonicalTerminal;
	diagnostics: AdapterDiagnostics;
};

export type RerankExecResult = {
	kind: "json";
	response: CanonicalRerankResponse;
	terminal: CanonicalTerminal;
	diagnostics: AdapterDiagnostics;
};

async function parseBody(res: Response): Promise<unknown> {
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** A handler's error mapper: turns a network error or a non-2xx upstream response into a GatewayError. */
type MapError = (err: unknown, ctx: AdapterContext) => GatewayError;

function firstOutputTimeout(): GatewayError {
	return new GatewayError({
		class: "timeout",
		code: "upstream_first_output_timeout",
		message: "Upstream execution exceeded the first output deadline",
		failureKind: "transient",
		deploymentHealth: "penalize",
	});
}

function firstOutputRemaining(ctx: AdapterContext): number | null {
	if (!ctx.executionPolicy) return null;
	return Math.max(
		0,
		ctx.executionPolicy.firstOutputMs -
			(Date.now() - (ctx.attemptStartedAt ?? Date.now())),
	);
}

export async function beforeFirstOutput<T>(
	promise: Promise<T>,
	ctx: AdapterContext,
): Promise<T> {
	const remaining = firstOutputRemaining(ctx);
	if (remaining === null) return promise;
	if (remaining <= 0) throw firstOutputTimeout();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(firstOutputTimeout()), remaining);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

export function remainingExecutionPolicy(ctx: AdapterContext) {
	if (!ctx.executionPolicy) return undefined;
	return {
		...ctx.executionPolicy,
		firstOutputMs: Math.max(1, firstOutputRemaining(ctx) ?? 1),
	};
}

async function* mapStreamErrors<T>(
	items: AsyncIterable<T>,
	ctx: AdapterContext,
	mapError: MapError,
): AsyncIterable<T> {
	try {
		for await (const item of items) yield item;
	} catch (error) {
		if (GatewayError.is(error)) throw error;
		if (ctx.signal?.aborted) throw abortGatewayError(ctx.signal);
		throw mapError(error, ctx);
	}
}

export async function* traceUpstreamStream<T>(
	items: AsyncIterable<T>,
	ctx: AdapterContext,
): AsyncIterable<T> {
	const span = ctx.operationId
		? startOperationChildTelemetry(ctx.operationId, "stream")
		: null;
	let errorCode: string | null = null;
	try {
		for await (const item of items) yield item;
	} catch (error) {
		errorCode = GatewayError.is(error)
			? (error.code ?? error.class)
			: "internal_error";
		throw error;
	} finally {
		if (span) finishOperationChildTelemetry(span, errorCode);
	}
}

/**
 * Performs the upstream fetch shared by every operation: dispatches the request, maps network errors
 * and non-2xx responses to GatewayError via the handler's `mapError`, and returns the raw 2xx
 * Response for the caller to parse (JSON or stream).
 */
async function dispatch(
	httpReq: UpstreamHttpRequest<NonNullable<RequestInit["body"]>>,
	ctx: AdapterContext,
	mapError: MapError,
): Promise<Response> {
	let res: Response;
	try {
		// Reject an already-exhausted request-wide deadline before constructing the fetch promise.
		await beforeFirstOutput(Promise.resolve(), ctx);
		res = await beforeFirstOutput(
			upstreamFetch(ctx, httpReq.url, {
				method: httpReq.method,
				headers: httpReq.headers,
				...(httpReq.body !== undefined ? { body: httpReq.body } : {}),
			}),
			ctx,
		);
	} catch (err) {
		if (GatewayError.is(err)) throw err;
		throw mapError(err, ctx);
	}

	if (ctx.timings === undefined) ctx.timings = {};
	ctx.timings.headersAt = Date.now();
	for (const name of [
		"x-request-id",
		"request-id",
		"x-goog-request-id",
		"anthropic-request-id",
	]) {
		const value = res.headers.get(name);
		if (value) {
			adapterContextDiagnostics(ctx).providerRequestId = value;
			break;
		}
	}
	if (!res.ok) {
		const retryAfter = res.headers.get("retry-after");
		throw mapError(
			{
				status: res.status,
				body: await beforeFirstOutput(parseBody(res), ctx),
				...(retryAfter !== null
					? { headers: { "retry-after": retryAfter } }
					: {}),
			},
			ctx,
		);
	}
	return res;
}

/** Asserts a streaming upstream actually returned a body, mapping the empty case to GatewayError. */
function requireStreamBody(
	res: Response,
	ctx: AdapterContext,
	mapError: MapError,
): ReadableStream<Uint8Array> {
	if (!res.body) {
		throw mapError(
			{ status: 502, body: "upstream returned an empty stream" },
			ctx,
		);
	}
	return res.body;
}

/**
 * Executes a chat call against the adapter's upstream: builds the request, performs the fetch and
 * normalizes the response (json or stream). Any failure is translated to GatewayError via
 * adapter.chat.mapError (network, timeout, or non-2xx status).
 */
export async function executeChat(
	adapter: Adapter,
	req: CanonicalChatRequest,
	ctx: AdapterContext,
): Promise<ChatExecResult> {
	const handler = adapter.chat;
	if (!handler) {
		// Should not happen: the resolver already validates the handler.
		throw new Error(`Adapter "${adapter.key}" does not implement chat`);
	}

	// buildRequest can throw GatewayError (missing creds, unsupported content).
	assertTextRequestSupported(req, ctx.meta);
	const res = await dispatch(
		handler.buildRequest(req, ctx),
		ctx,
		handler.mapError,
	);

	if (req.stream) {
		const body = requireStreamBody(res, ctx, handler.mapError);
		const observed = observeChatStream(
			mapStreamErrors(handler.parseStream(body, ctx), ctx, handler.mapError),
			remainingExecutionPolicy(ctx),
			adapterContextDiagnostics(ctx),
		);
		return {
			kind: "stream",
			chunks: traceUpstreamStream(observed.items, ctx),
			observation: observed.observation,
		};
	}

	const response = await beforeFirstOutput(
		Promise.resolve(parseBody(res)).then((raw) =>
			handler.parseResponse(raw, ctx),
		),
		ctx,
	);
	const responseDiagnostics = adapterDiagnostics(response);
	const diagnostics = {
		...adapterContextDiagnostics(ctx),
		...(responseDiagnostics ?? {}),
		metadata: {
			...(adapterContextDiagnostics(ctx).metadata ?? {}),
			...(responseDiagnostics?.metadata ?? {}),
		},
	};
	return {
		kind: "json",
		response,
		terminal: terminalForChatResponse(response),
		diagnostics,
	};
}

/** Executes an image generation/edit and normalizes JSON or SSE events. */
export async function executeImage(
	adapter: Adapter,
	req: CanonicalImageRequest,
	ctx: AdapterContext,
): Promise<ImageExecResult> {
	const handler =
		req.operation === "generation"
			? adapter.imageGeneration
			: adapter.imageEdit;
	if (!handler)
		throw new Error(
			`Adapter "${adapter.key}" does not implement images.${req.operation}`,
		);

	const res = await dispatch(
		await handler.buildRequest(req, ctx),
		ctx,
		handler.mapError,
	);

	if (
		req.stream &&
		imageProfileFor(ctx.meta, req.operation)?.supportsNativeStreaming &&
		handler.parseStream
	) {
		const body = requireStreamBody(res, ctx, handler.mapError);
		const observed = observeImageStream(
			mapStreamErrors(handler.parseStream(body, ctx), ctx, handler.mapError),
			remainingExecutionPolicy(ctx),
			adapterContextDiagnostics(ctx),
		);
		return {
			kind: "stream",
			events: traceUpstreamStream(observed.items, ctx),
			observation: observed.observation,
		};
	}
	const response = await beforeFirstOutput(
		Promise.resolve(parseBody(res)).then((raw) =>
			handler.parseResponse(raw, ctx),
		),
		ctx,
	);
	if (response.data.length === 0)
		throw new GatewayError({
			class: "server",
			code: "upstream_protocol_error",
			message: "Upstream image response contained no images",
			failureKind: "transient",
			deploymentHealth: "penalize",
		});
	return {
		kind: "json",
		response,
		terminal: completedTerminal(),
		diagnostics: adapterContextDiagnostics(ctx),
	};
}

/**
 * Executes an audio transcription: builds the multipart, performs the fetch and normalizes the
 * response. For `text`/`srt`/`vtt` formats the upstream returns plain text; `parseBody` leaves it as
 * a string and the handler wraps it in `{ text }`.
 */
export async function executeTranscription(
	adapter: Adapter,
	req: CanonicalTranscriptionRequest,
	ctx: AdapterContext,
): Promise<TranscriptionExecResult> {
	const handler = adapter.audioTranscription;
	if (!handler)
		throw new Error(
			`Adapter "${adapter.key}" does not implement audio.transcriptions`,
		);

	const res = await dispatch(
		await handler.buildRequest(req, ctx),
		ctx,
		handler.mapError,
	);

	if (req.stream && handler.parseStream) {
		const body = requireStreamBody(res, ctx, handler.mapError);
		const observed = observeTranscriptionStream(
			mapStreamErrors(handler.parseStream(body, ctx), ctx, handler.mapError),
			remainingExecutionPolicy(ctx),
			adapterContextDiagnostics(ctx),
		);
		return {
			kind: "stream",
			events: traceUpstreamStream(observed.items, ctx),
			observation: observed.observation,
		};
	}
	const response = await beforeFirstOutput(
		Promise.resolve(parseBody(res)).then((raw) =>
			handler.parseResponse(raw, ctx),
		),
		ctx,
	);
	return {
		kind: "json",
		response,
		terminal: completedTerminal(),
		diagnostics: adapterContextDiagnostics(ctx),
	};
}

/** Executes an embeddings call and normalizes the JSON response. */
export async function executeEmbeddings(
	adapter: Adapter,
	req: CanonicalEmbeddingsRequest,
	ctx: AdapterContext,
): Promise<EmbeddingsExecResult> {
	const handler = adapter.embeddings;
	if (!handler)
		throw new Error(`Adapter "${adapter.key}" does not implement embeddings`);

	const res = await dispatch(
		handler.buildRequest(req, ctx),
		ctx,
		handler.mapError,
	);

	const response = await beforeFirstOutput(
		Promise.resolve(parseBody(res)).then((raw) =>
			handler.parseResponse(raw, ctx),
		),
		ctx,
	);
	if (response.data.length === 0)
		throw new GatewayError({
			class: "server",
			code: "upstream_protocol_error",
			message: "Upstream embeddings response contained no embeddings",
			failureKind: "transient",
			deploymentHealth: "penalize",
		});
	return {
		kind: "json",
		response,
		terminal: completedTerminal(),
		diagnostics: adapterContextDiagnostics(ctx),
	};
}

/** Executes a reranking call and validates the normalized ranking. */
export async function executeRerank(
	adapter: Adapter,
	req: CanonicalRerankRequest,
	ctx: AdapterContext,
): Promise<RerankExecResult> {
	const handler = adapter.rerank;
	if (!handler)
		throw new Error(`Adapter "${adapter.key}" does not implement rerank`);

	const res = await dispatch(
		handler.buildRequest(req, ctx),
		ctx,
		handler.mapError,
	);
	const response = await beforeFirstOutput(
		Promise.resolve(parseBody(res)).then((raw) =>
			handler.parseResponse(raw, ctx),
		),
		ctx,
	);
	assertRerankResponseValid(req, response);
	return {
		kind: "json",
		response,
		terminal: completedTerminal(),
		diagnostics: adapterContextDiagnostics(ctx),
	};
}
