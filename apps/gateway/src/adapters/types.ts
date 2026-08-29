import type { UpstreamTransport, AdapterTransports } from "#core/transport.ts";
import type { ExecutionPolicy } from "#core/executionPolicy.ts";
import type { ReasoningControlKind } from "#core/reasoning.ts";
import type { ResolvedModelMetadata } from "#catalog/types.ts";
import type { GatewayError } from "#core/errors.ts";
import type { CallType } from "#core/callType.ts";

import type {
	CanonicalTranscriptionStreamEvent,
	CanonicalTranscriptionResponse,
	CanonicalTranscriptionRequest,
} from "#core/audio.ts";

import type {
	CanonicalVideoProviderJob,
	CanonicalVideoRequest,
	CanonicalVideoContent,
	VideoAssetVariant,
} from "#core/videos.ts";

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

import type {
	CanonicalRerankResponse,
	CanonicalRerankRequest,
} from "#core/rerank.ts";

/** Upstream error the executor passes to `mapError` when the response is not 2xx. */
export interface UpstreamError {
	status: number;
	/** Already-parsed error body (JSON) or raw text. */
	body: unknown;
	/** Selected response headers that affect retry behavior. */
	headers?: Record<string, string>;
}

/** HTTP request built toward the upstream. The executor runs it with fetch. */
type UpstreamBody = NonNullable<RequestInit["body"]>;

export type ContentInputSource = "provider_file_id" | "url" | "data_url";

export interface ContentPartInputSupport {
	/** Source forms the transport can receive without gateway-side materialization. */
	sources: readonly ContentInputSource[];
	/** Optional MIME allowlist. Supports exact values and type wildcards such as text/*. */
	mimeTypes?: readonly string[];
	/** Inline byte limit enforced before the adapter serializes the request. */
	maxBytes?: number;
}

/**
 * Multimodal input capabilities for one upstream transport. New canonical content kinds belong here
 * instead of in provider-specific routing branches.
 */
export interface ContentInputTransportSupport {
	audio?: ContentPartInputSupport;
	file?: ContentPartInputSupport;
	image?: ContentPartInputSupport;
	video?: ContentPartInputSupport;
}

export interface UpstreamHttpRequest<TBody extends UpstreamBody = string> {
	method: string;
	url: string;
	headers: Record<string, string>;
	/** Serialized body: a JSON string or FormData on binary endpoints. */
	body?: TBody;
}

/** Context the router/executor passes to the adapter for a specific call. */
export interface AdapterContext {
	/** The model at the upstream (upstream_model of the chosen deployment). */
	upstreamModel: string;
	/** Already-decrypted credentials (api key, base url, org id, headers...). */
	credentials: Record<string, unknown>;
	/** Effective model metadata (catalog + override): capabilities, pricing, limits, reasoning. */
	meta: ResolvedModelMetadata;
	/** Upstream transport resolved for this call. */
	transport: UpstreamTransport;
	requestId: string;
	operationId?: string;
	/** Epoch at which the router acquired this attempt, used for request-wide first-output timing. */
	attemptStartedAt?: number;
	/** To cancel/timeout the upstream call. */
	signal?: AbortSignal;
	/** Provider-agnostic deadlines enforced by the executor, never interpreted by adapters. */
	executionPolicy?: ExecutionPolicy;
	/** Mutable private evidence for transport-level observations that do not produce a public frame. */
	diagnostics?: AdapterDiagnostics;
	/** Private transport timestamps populated by the instrumented executor. */
	timings?: { headersAt?: number };
	/** Byte counters populated only by the instrumented HTTP/WebSocket transport. */
	transportStats?: { upstreamBytes: number };
}

export interface ChatRoutingContext {
	upstreamModel: string;
	meta: ResolvedModelMetadata;
	nativeTransport: UpstreamTransport;
}

export interface ChatSupportContext {
	upstreamModel: string;
	meta: ResolvedModelMetadata;
	transport: UpstreamTransport;
}

/** Safe, private provider evidence retained for operator diagnostics and never rendered publicly. */
export interface AdapterDiagnostics {
	providerRequestId?: string;
	modelVersion?: string;
	originalTerminalReason?: string;
	transportTerminator?:
		| "eof"
		| "done_marker"
		| "semantic_event"
		| "websocket_turn";
	/** Private normalized evidence when a protocol outcome cannot be represented by finishReason alone. */
	terminal?: {
		outcome: "completed" | "incomplete" | "blocked";
		reason:
			| "stop"
			| "length"
			| "tool_calls"
			| "content_filter"
			| "refusal"
			| "other";
	};
	metadata?: Record<string, unknown>;
}

/** An adapter's canonical text handler. */
export interface ChatHandler {
	buildRequest(
		req: CanonicalChatRequest,
		ctx: AdapterContext,
	): UpstreamHttpRequest;
	parseResponse(raw: unknown, ctx: AdapterContext): CanonicalChatResponse;
	parseStream(
		stream: ReadableStream<Uint8Array>,
		ctx: AdapterContext,
	): AsyncIterable<CanonicalChatStreamChunk>;
	/** Maps an upstream error (non-2xx HTTP, error body, exception) to a GatewayError. */
	mapError(err: unknown, ctx: AdapterContext): GatewayError;
}

export interface MessageTokenCountRequest {
	canonical: CanonicalChatRequest;
	/** Parsed Anthropic request retained so native counters receive future-compatible input fields. */
	rawBody: Record<string, unknown>;
}

export interface MessageTokenCountResponse {
	inputTokens: number;
}

/** Optional native implementation of Anthropic's Messages token-count endpoint. */
export interface MessageTokenCountHandler {
	buildRequest(
		req: MessageTokenCountRequest,
		ctx: AdapterContext,
	): UpstreamHttpRequest;
	parseResponse(raw: unknown, ctx: AdapterContext): MessageTokenCountResponse;
	mapError(err: unknown, ctx: AdapterContext): GatewayError;
}

/**
 * A persistent upstream Responses WebSocket. The gateway still translates every event through the
 * canonical core; this is a transport optimization, never a public-protocol passthrough.
 */
export interface ResponsesWebSocketTurn {
	chunks: AsyncIterable<CanonicalChatStreamChunk>;
	/** Resolves after response.created (or the terminal event when no id was emitted). */
	upstreamResponseId: Promise<string | null>;
}

export interface ResponsesWebSocketSession {
	create(
		req: CanonicalChatRequest,
		options: {
			previousResponseId?: string;
			generate: boolean;
			signal: AbortSignal;
		},
	): Promise<ResponsesWebSocketTurn>;
	close(code?: number, reason?: string): void;
	readonly closed: boolean;
}

export interface ResponsesWebSocketHandler {
	connect(ctx: AdapterContext): Promise<ResponsesWebSocketSession>;
}

export interface ImageHandler {
	buildRequest(
		req: CanonicalImageRequest,
		ctx: AdapterContext,
	):
		| UpstreamHttpRequest<UpstreamBody>
		| Promise<UpstreamHttpRequest<UpstreamBody>>;
	parseResponse(
		raw: unknown,
		ctx: AdapterContext,
	): CanonicalImageResponse | Promise<CanonicalImageResponse>;
	parseStream?(
		stream: ReadableStream<Uint8Array>,
		ctx: AdapterContext,
	): AsyncIterable<CanonicalImageStreamEvent>;
	mapError(err: unknown, ctx: AdapterContext): GatewayError;
}

/** An adapter's canonical audio-transcription handler. */
export interface TranscriptionHandler {
	buildRequest(
		req: CanonicalTranscriptionRequest,
		ctx: AdapterContext,
	):
		| UpstreamHttpRequest<UpstreamBody>
		| Promise<UpstreamHttpRequest<UpstreamBody>>;
	/** `raw` is a JSON object (json/verbose_json) or a raw string (text/srt/vtt). */
	parseResponse(
		raw: unknown,
		ctx: AdapterContext,
	): CanonicalTranscriptionResponse;
	parseStream?(
		stream: ReadableStream<Uint8Array>,
		ctx: AdapterContext,
	): AsyncIterable<CanonicalTranscriptionStreamEvent>;
	mapError(err: unknown, ctx: AdapterContext): GatewayError;
}

/** An adapter's canonical embeddings handler. No streaming. */
export interface EmbeddingsHandler {
	buildRequest(
		req: CanonicalEmbeddingsRequest,
		ctx: AdapterContext,
	): UpstreamHttpRequest;
	parseResponse(raw: unknown, ctx: AdapterContext): CanonicalEmbeddingsResponse;
	mapError(err: unknown, ctx: AdapterContext): GatewayError;
}

/** An adapter's canonical reranking handler. No streaming. */
export interface RerankHandler {
	/** Whether the OpenRouter-shaped `provider` routing object can be honored. */
	supportsProviderRouting?: boolean;
	buildRequest(
		req: CanonicalRerankRequest,
		ctx: AdapterContext,
	): UpstreamHttpRequest;
	parseResponse(raw: unknown, ctx: AdapterContext): CanonicalRerankResponse;
	mapError(err: unknown, ctx: AdapterContext): GatewayError;
}

export interface VideoJobRef {
	upstreamJobId: string;
	upstreamGenerationId?: string | null;
	upstreamPollingUrl?: string | null;
	providerState?: Record<string, unknown> | null;
}

/** An adapter's async video-generation handler. */
export interface VideoHandler {
	submit(
		req: CanonicalVideoRequest,
		ctx: AdapterContext,
	): Promise<CanonicalVideoProviderJob>;
	refresh(
		job: VideoJobRef,
		ctx: AdapterContext,
	): Promise<CanonicalVideoProviderJob>;
	download(
		job: VideoJobRef,
		variant: VideoAssetVariant,
		ctx: AdapterContext,
	): Promise<CanonicalVideoContent>;
	/** Best-effort upstream delete/cancel. Absent when the provider has no such endpoint. */
	remove?(job: VideoJobRef, ctx: AdapterContext): Promise<void>;
	mapError(err: unknown, ctx: AdapterContext): GatewayError;
}

/**
 * An adapter implements one or more upstream protocols. It is registered in code.
 *
 * Public endpoints render canonical types per family. Chat feeds Chat, Responses, and Messages;
 * Images has its own binary/event contracts and can travel over OpenAI Images, multimodal
 * chat_completions, or generateContent.
 */
export interface Adapter {
	key: string;
	credentials: {
		required: readonly string[];
	};
	supportedCallTypes: ReadonlySet<CallType>;
	chat?: ChatHandler;
	/** Selects a request-specific native text transport before balancing. */
	preferredChatTransport?(
		req: CanonicalChatRequest,
		ctx: ChatRoutingContext,
	): UpstreamTransport | undefined;
	/** Rejects requests whose guarantee cannot be honored by the resolved transport. */
	assertChatRequestSupported?(
		req: CanonicalChatRequest,
		ctx: ChatSupportContext,
	): void;
	messageTokenCount?: MessageTokenCountHandler;
	/** Optional native persistent /responses WebSocket transport. */
	responsesWebSocket?: ResponsesWebSocketHandler;
	imageGeneration?: ImageHandler;
	imageEdit?: ImageHandler;
	videoGeneration?: VideoHandler;
	audioTranscription?: TranscriptionHandler;
	embeddings?: EmbeddingsHandler;
	rerank?: RerankHandler;
	/** Upstream transports per CallType. */
	transports?: Partial<Record<CallType, AdapterTransports>>;
	/** Native multimodal-input support by upstream transport. */
	contentInputs?: Partial<
		Record<UpstreamTransport, ContentInputTransportSupport>
	>;
	/**
	 * Reasoning-control families this adapter can emit to the upstream. Validated at boot against the
	 * catalog: a model with a `reasoning.kind` outside this set fails at startup (it used to fail at
	 * request time). Absent = not validated.
	 */
	reasoningKinds?: ReadonlySet<ReasoningControlKind>;
}

/** A provider as a self-contained upstream-protocol unit. The JSON catalog is mounted in the central registry. */
export interface ProviderModule {
	adapter: Adapter;
}
