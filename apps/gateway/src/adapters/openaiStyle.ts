import { makeOpenAIResponsesWebSocketHandler } from "./openaiResponsesWebSocket.ts";
import type { Adapter, AdapterContext, ChatHandler } from "./types.ts";
import { imageProfileFor, videoProfileFor } from "#catalog/types.ts";
import { upstreamFetch } from "#gateway/instrumentedTransport.ts";
import { looksLikeContextWindowError } from "#core/httpError.ts";
import { GatewayError, type ErrorClass } from "#core/errors.ts";
import { type BaseCreds, requireApiKeyCreds } from "./creds.ts";
import type { ReasoningControlKind } from "#core/reasoning.ts";
import type { UpstreamTransport } from "#core/transport.ts";
import { mapUpstreamHttpError } from "./upstreamError.ts";
import type { ImageOperation } from "#core/images.ts";
import { mergeExtraBody } from "#core/extraBody.ts";
import { parseSSE } from "#core/sse.ts";

import {
	buildDirectImageGenerationBody,
	parseDirectImagesResponse,
	buildDirectImageEditForm,
	parseDirectImageStream,
	parseOmniImageResponse,
	buildOmniImageBody,
} from "#contracts/openai/imagesTransport.ts";

import {
	type CanonicalVideoProviderJob,
	type CanonicalVideoRequest,
	type VideoUrlReference,
	type VideoAssetVariant,
	type VideoStatus,
	resolveVideoSize,
} from "#core/videos.ts";

import {
	responsesEventsToCanonicalChunks,
	buildResponsesRequestBody,
	parseResponsesResponse,
} from "#contracts/openai/responsesTransport.ts";

import {
	parseTranscriptionResponse,
	parseTranscriptionStream,
	buildTranscriptionForm,
} from "#contracts/openai/audioTransport.ts";

import {
	parseOpenAIChatResponse,
	parseOpenAIChatChunk,
	buildOpenAIChatBody,
} from "#contracts/openai/chatTransport.ts";

import type {
	TranscriptionHandler,
	EmbeddingsHandler,
	ImageHandler,
	VideoHandler,
	VideoJobRef,
} from "./types.ts";

import {
	recordUnknownAdapterEvent,
	adapterContextDiagnostics,
	attachAdapterDiagnostics,
} from "./diagnostics.ts";

import {
	parseEmbeddingsResponse,
	buildEmbeddingsBody,
} from "#contracts/openai/embeddingsTransport.ts";

/**
 * Factory for OpenAI Chat Completions-style adapters. Serves both the real OpenAI API and any
 * compatible provider (xAI, Mistral, Groq, Together, vLLM, Ollama...). The differences are
 * parametrized; everything else is shared.
 */
export interface OpenAIStyleConfig {
	key: string;
	label: string;
	/** Default base URL. If undefined, `baseUrl` in credentials is REQUIRED. */
	defaultBaseUrl?: string;
	/**
	 * Default upstream transport. Additional transports must be declared explicitly.
	 */
	defaultTransport: "chat_completions" | "responses";
	/** Text transports actually exposed by this provider. Defaults to only the default transport. */
	supportedChatTransports?: readonly ("chat_completions" | "responses")[];
	/** Native multimodal-input forms exposed by each configured text transport. */
	contentInputs?: Adapter["contentInputs"];
	/** Output-limit field (chat_completions transport only). OpenAI: max_completion_tokens; compatibles: max_tokens. */
	maxTokensField: "max_completion_tokens" | "max_tokens";
	/** OpenAI uses Bearer; Azure v1 with a key uses the api-key header. */
	authScheme?: "bearer" | "api-key";
	/** Base-URL-specific normalization/validation. */
	normalizeBaseUrl?: (baseUrl: string) => string;
	/** Send the openai-organization header if there is an org in credentials. */
	sendOrganization?: boolean;
	/**
	 * Refines a 400 to a more specific class (e.g. context_length_exceeded -> context_window), keeping
	 * status and provider. Receives the upstream message and the body. `null` = no change.
	 */
	refineBadRequest?: (message: string, body: unknown) => ErrorClass | null;
	/** Image protocols this adapter implements. Absent = chat only. */
	imageTransports?: readonly Extract<
		UpstreamTransport,
		"images" | "chat_completions"
	>[];
	defaultImageTransport?: Extract<
		UpstreamTransport,
		"images" | "chat_completions"
	>;
	/** The provider implements POST /audio/transcriptions (multipart). Absent = no audio. */
	audioTranscriptions?: boolean;
	/** The provider implements POST /embeddings. Absent = no embeddings. */
	embeddings?: boolean;
	/** Async video generation protocols this adapter implements. Absent = no videos. */
	videoTransports?: readonly Extract<
		UpstreamTransport,
		"videos" | "videos_async"
	>[];
	defaultVideoTransport?: Extract<UpstreamTransport, "videos" | "videos_async">;
	/** This provider exposes persistent WebSocket mode at its /responses resource. */
	responsesWebSocket?: boolean;
}

/**
 * Generic 400/422 refinement for OpenAI-compatible providers without a dedicated `code`:
 * reclassifies to `context_window` when the message reveals a context overflow (DeepSeek, GLM,
 * MiniMax, Kimi... report it by message). Reusable as `refineBadRequest`.
 */
export function contextWindowRefine(message: string): ErrorClass | null {
	return looksLikeContextWindowError(message) ? "context_window" : null;
}

interface Creds extends BaseCreds {
	organization?: string;
}

interface ResolvedCreds {
	apiKey: string;
	base: string;
	organization?: string;
	headers?: Record<string, string>;
}

export function makeOpenAIStyleAdapter(config: OpenAIStyleConfig): Adapter {
	function resolveCreds(ctx: AdapterContext): ResolvedCreds {
		const c = requireApiKeyCreds<Creds>(ctx.credentials, config.label);
		const base = c.baseUrl ?? config.defaultBaseUrl;
		if (!base) {
			throw new GatewayError({
				class: "bad_request",
				message: `${config.label}: missing 'baseUrl' in credentials`,
			});
		}
		const normalizedBase = config.normalizeBaseUrl
			? config.normalizeBaseUrl(base)
			: base.replace(/\/+$/, "");
		const resolved: ResolvedCreds = { apiKey: c.apiKey, base: normalizedBase };
		if (c.organization !== undefined) resolved.organization = c.organization;
		if (c.headers !== undefined) resolved.headers = c.headers;
		return resolved;
	}

	function buildHeaders(c: ResolvedCreds): Record<string, string> {
		return {
			"content-type": "application/json",
			...(config.authScheme === "api-key"
				? { "api-key": c.apiKey }
				: { authorization: `Bearer ${c.apiKey}` }),
			...(config.sendOrganization && c.organization
				? { "openai-organization": c.organization }
				: {}),
			...(c.headers ?? {}),
		};
	}

	function buildAuthHeaders(c: ResolvedCreds): Record<string, string> {
		const { "content-type": _omit, ...headers } = buildHeaders(c);
		return headers;
	}

	function mapError(err: unknown, ctx: AdapterContext): GatewayError {
		return mapUpstreamHttpError(
			err,
			{
				label: config.label,
				...(config.refineBadRequest
					? { refineBadRequest: config.refineBadRequest }
					: {}),
			},
			ctx,
		);
	}

	async function parseHttpBody(res: Response): Promise<unknown> {
		const text = await res.text();
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}

	async function fetchJson(
		req: {
			method: string;
			url: string;
			headers: Record<string, string>;
			body?: string;
		},
		ctx: AdapterContext,
	): Promise<unknown> {
		let res: Response;
		try {
			res = await upstreamFetch(ctx, req.url, {
				method: req.method,
				headers: req.headers,
				...(req.body !== undefined ? { body: req.body } : {}),
				...(ctx.signal ? { signal: ctx.signal } : {}),
			});
		} catch (err) {
			throw mapError(err, ctx);
		}
		if (!res.ok) {
			throw mapError(
				{ status: res.status, body: await parseHttpBody(res) },
				ctx,
			);
		}
		return parseHttpBody(res);
	}

	async function fetchContent(
		url: string,
		headers: Record<string, string>,
		ctx: AdapterContext,
	) {
		let res: Response;
		try {
			res = await upstreamFetch(ctx, url, {
				method: "GET",
				headers,
				...(ctx.signal ? { signal: ctx.signal } : {}),
			});
		} catch (err) {
			throw mapError(err, ctx);
		}
		if (!res.ok) {
			throw mapError(
				{ status: res.status, body: await parseHttpBody(res) },
				ctx,
			);
		}
		if (!res.body) {
			throw new GatewayError({
				class: "server",
				message: `${config.label}: video content response had no body`,
			});
		}
		const length = res.headers.get("content-length");
		return {
			body: res.body,
			contentType: res.headers.get("content-type") ?? "video/mp4",
			...(length ? { contentLength: Number(length) } : {}),
		};
	}

	// Stream of the chat_completions transport (OpenAI chunks -> canonical).
	async function* completionsStream(
		stream: ReadableStream<Uint8Array>,
		ctx: AdapterContext,
	): AsyncGenerator<ReturnType<typeof parseOpenAIChatChunk>> {
		let transportDone = false;
		for await (const event of parseSSE(stream)) {
			if (event.data === "[DONE]") {
				transportDone = true;
				adapterContextDiagnostics(ctx).transportTerminator = "done_marker";
				break;
			}
			let json: unknown;
			try {
				json = JSON.parse(event.data);
			} catch (cause) {
				throw new GatewayError({
					class: "server",
					code: "upstream_protocol_error",
					message: `${config.label}: stream contained malformed JSON`,
					provider: { body: event.data },
					cause,
				});
			}
			if (json !== null && typeof json === "object" && "error" in json) {
				throw mapError({ status: 502, body: json }, ctx);
			}
			if (
				json === null ||
				typeof json !== "object" ||
				(!("choices" in json) && !("usage" in json))
			)
				recordUnknownAdapterEvent(
					adapterContextDiagnostics(ctx),
					"chat_completions.unknown_json_shape",
				);
			const chunk = parseOpenAIChatChunk(json);
			const originalTerminalReason = (
				json as { choices?: Array<{ finish_reason?: unknown }> }
			).choices?.find((choice) => choice.finish_reason != null)?.finish_reason;
			yield originalTerminalReason == null
				? chunk
				: attachAdapterDiagnostics(chunk, {
						originalTerminalReason: String(originalTerminalReason),
					});
		}
		if (!transportDone)
			throw new GatewayError({
				class: "server",
				code: "upstream_protocol_error",
				message: `${config.label}: stream ended without [DONE]`,
				failureKind: "transient",
				deploymentHealth: "penalize",
			});
	}

	async function* responsesStream(
		stream: ReadableStream<Uint8Array>,
		ctx: AdapterContext,
	): AsyncGenerator<ReturnType<typeof parseOpenAIChatChunk>> {
		const unknownEvents: string[] = [];
		let originalTerminalReason: string | undefined;
		let terminal:
			| NonNullable<NonNullable<AdapterContext["diagnostics"]>["terminal"]>
			| undefined;
		for await (const chunk of responsesEventsToCanonicalChunks(
			parseSSE(stream),
			{
				onUnknownEvent: (type) => {
					unknownEvents.push(type);
					recordUnknownAdapterEvent(adapterContextDiagnostics(ctx), type);
				},
				onTransportTerminator: (terminator) => {
					adapterContextDiagnostics(ctx).transportTerminator = terminator;
				},
				onTerminalEvent: (type, originalReason, normalizedReason) => {
					originalTerminalReason = originalReason;
					terminal =
						type === "response.incomplete"
							? { outcome: "incomplete", reason: normalizedReason }
							: { outcome: "completed", reason: normalizedReason };
				},
			},
		)) {
			if (unknownEvents.length > 0 || originalTerminalReason || terminal) {
				yield attachAdapterDiagnostics(chunk, {
					...(originalTerminalReason ? { originalTerminalReason } : {}),
					...(terminal ? { terminal } : {}),
					...(unknownEvents.length > 0
						? { metadata: { unknownEvents: unknownEvents.splice(0) } }
						: {}),
				});
				originalTerminalReason = undefined;
				terminal = undefined;
			} else yield chunk;
		}
	}

	// A single chat handler that picks the upstream transport based on ctx.transport.
	const chat: ChatHandler = {
		buildRequest(req, ctx) {
			const c = resolveCreds(ctx);
			const supportedChatTransports = config.supportedChatTransports ?? [
				"chat_completions",
				"responses",
			];
			if (
				(ctx.transport !== "chat_completions" &&
					ctx.transport !== "responses") ||
				!supportedChatTransports.includes(ctx.transport)
			) {
				throw new GatewayError({
					class: "server",
					message: `${config.label}: transport "${ctx.transport}" is not supported`,
				});
			}
			if (ctx.transport === "responses") {
				return {
					method: "POST",
					url: `${c.base}/responses`,
					headers: buildHeaders(c),
					body: JSON.stringify(
						buildResponsesRequestBody(
							req,
							ctx.upstreamModel,
							ctx.meta.reasoning,
						),
					),
				};
			}
			return {
				method: "POST",
				url: `${c.base}/chat/completions`,
				headers: buildHeaders(c),
				body: JSON.stringify(
					buildOpenAIChatBody(req, ctx.upstreamModel, {
						maxTokensField: config.maxTokensField,
						...(ctx.meta.reasoning !== undefined
							? { reasoningSpec: ctx.meta.reasoning }
							: {}),
					}),
				),
			};
		},
		parseResponse(raw, ctx) {
			const response =
				ctx.transport === "responses"
					? parseResponsesResponse(raw)
					: parseOpenAIChatResponse(raw);
			const record = (raw ?? {}) as {
				status?: unknown;
				incomplete_details?: { reason?: unknown };
				choices?: Array<{ finish_reason?: unknown }>;
			};
			const originalTerminalReason =
				ctx.transport === "responses"
					? (record.incomplete_details?.reason ?? record.status)
					: record.choices?.find((choice) => choice.finish_reason != null)
							?.finish_reason;
			const terminal =
				ctx.transport === "responses"
					? record.status === "incomplete"
						? ({
								outcome: "incomplete",
								reason: response.choices[0]?.finishReason ?? "other",
							} as const)
						: ({
								outcome: "completed",
								reason: response.choices[0]?.finishReason ?? "other",
							} as const)
					: undefined;
			return originalTerminalReason == null && terminal === undefined
				? response
				: attachAdapterDiagnostics(response, {
						...(originalTerminalReason == null
							? {}
							: { originalTerminalReason: String(originalTerminalReason) }),
						...(terminal ? { terminal } : {}),
					});
		},
		parseStream(stream, ctx) {
			return ctx.transport === "responses"
				? responsesStream(stream, ctx)
				: completionsStream(stream, ctx);
		},
		mapError(err, ctx) {
			return mapError(err, ctx);
		},
	};

	function makeImageHandler(operation: ImageOperation): ImageHandler {
		return {
			async buildRequest(req, ctx) {
				const c = resolveCreds(ctx);
				const profile = imageProfileFor(ctx.meta, operation);
				if (ctx.transport === "images") {
					if (operation === "edit") {
						return {
							method: "POST",
							url: `${c.base}/images/edits`,
							headers: buildAuthHeaders(c),
							body: await buildDirectImageEditForm(
								req,
								ctx.upstreamModel,
								profile,
							),
						};
					}
					return {
						method: "POST",
						url: `${c.base}/images/generations`,
						headers: buildHeaders(c),
						body: JSON.stringify(
							buildDirectImageGenerationBody(req, ctx.upstreamModel, profile),
						),
					};
				}
				if (ctx.transport === "chat_completions") {
					return {
						method: "POST",
						url: `${c.base}/chat/completions`,
						headers: buildHeaders(c),
						body: JSON.stringify(
							await buildOmniImageBody(req, ctx.upstreamModel, profile),
						),
					};
				}
				throw new GatewayError({
					class: "server",
					message: `${config.label}: transport "${ctx.transport}" cannot produce images`,
				});
			},
			parseResponse(raw, ctx) {
				return ctx.transport === "images"
					? parseDirectImagesResponse(raw)
					: parseOmniImageResponse(raw);
			},
			parseStream(stream, ctx) {
				if (ctx.transport !== "images") {
					throw new GatewayError({
						class: "server",
						message: `${config.label}: image streaming requires transport images`,
					});
				}
				return parseDirectImageStream(stream, operation, {
					onUnknownEvent: (type) =>
						recordUnknownAdapterEvent(adapterContextDiagnostics(ctx), type),
					onTransportTerminator: (terminator) => {
						adapterContextDiagnostics(ctx).transportTerminator = terminator;
					},
				});
			},
			mapError(err, ctx) {
				return mapError(err, ctx);
			},
		};
	}

	function mapVideoStatus(
		raw: unknown,
		dialect: "videos" | "videos_async",
	): VideoStatus {
		const status = String(raw ?? "");
		if (dialect === "videos_async") {
			if (status === "pending") return "queued";
			if (status === "completed") return "completed";
			if (status === "failed" || status === "cancelled" || status === "expired")
				return "failed";
			// in_progress, plus any status this gateway does not know yet: keep polling; the
			// job-runtime timeout is the safety net if it never terminates.
			return "in_progress";
		}
		if (
			status === "queued" ||
			status === "in_progress" ||
			status === "completed" ||
			status === "failed"
		) {
			return status;
		}
		return "in_progress";
	}

	function normalizeProgress(status: VideoStatus, raw: unknown): number {
		if (typeof raw === "number" && Number.isFinite(raw)) {
			return Math.max(0, Math.min(100, Math.round(raw)));
		}
		switch (status) {
			case "queued":
				return 0;
			case "in_progress":
				return 50;
			case "completed":
			case "failed":
				return 100;
		}
	}

	function parseVideoJob(
		raw: unknown,
		dialect: "videos" | "videos_async",
		fallbackJobId?: string,
	): CanonicalVideoProviderJob {
		const value = (raw ?? {}) as Record<string, unknown>;
		const upstreamJobId =
			typeof value.id === "string" && value.id ? value.id : fallbackJobId;
		if (!upstreamJobId) {
			throw new GatewayError({
				class: "server",
				message: `${config.label}: video response is missing id`,
			});
		}
		const status = mapVideoStatus(value.status, dialect);
		const error =
			typeof value.error === "string"
				? { message: value.error }
				: value.error && typeof value.error === "object"
					? (value.error as { code?: string | null; message?: string })
					: undefined;
		return {
			upstreamJobId,
			...(typeof value.generation_id === "string"
				? { upstreamGenerationId: value.generation_id }
				: {}),
			...(typeof value.polling_url === "string"
				? { upstreamPollingUrl: value.polling_url }
				: {}),
			status,
			progress: normalizeProgress(status, value.progress),
			...(error
				? {
						error: {
							code:
								error.code ??
								(status === "failed" ? String(value.status) : null),
							message: error.message ?? "Video generation failed",
						},
					}
				: status === "failed"
					? {
							error: {
								code:
									typeof value.status === "string"
										? value.status
										: "video_failed",
								message: "Video generation failed",
							},
						}
					: {}),
			...(value.usage && typeof value.usage === "object"
				? { usage: value.usage as Record<string, unknown> }
				: {}),
			providerState: value,
		};
	}

	function buildOpenAIVideoBody(
		req: CanonicalVideoRequest,
		ctx: AdapterContext,
	): Record<string, unknown> {
		const resolved = resolveVideoSize(req, videoProfileFor(ctx.meta));
		const refs = req.inputReferences ?? [];
		if (refs.length > 1) {
			throw new GatewayError({
				class: "bad_request",
				message: `${config.label}: the videos transport accepts a single input reference`,
				param: "input_references",
			});
		}
		if (req.frameImages && req.frameImages.length > 0) {
			throw new GatewayError({
				class: "bad_request",
				message: `${config.label}: the videos transport does not support frame_images`,
				param: "frame_images",
			});
		}
		const body: Record<string, unknown> = {
			model: ctx.upstreamModel,
			prompt: req.prompt,
			...(req.seconds !== undefined ? { seconds: req.seconds } : {}),
			...(resolved?.size !== undefined ? { size: resolved.size } : {}),
			// Only reachable when the model profile declares support; the stock OpenAI
			// Videos API accepts none of these three.
			...(req.quality !== undefined ? { quality: req.quality } : {}),
			...(req.seed !== undefined ? { seed: req.seed } : {}),
			...(req.generateAudio !== undefined
				? { generate_audio: req.generateAudio }
				: {}),
		};
		const ref = refs[0];
		if (ref) {
			if (ref.type === "image_url") {
				body.input_reference = { image_url: ref.url };
			} else if (ref.type === "file_id") {
				body.input_reference = { file_id: ref.fileId };
			} else {
				throw new GatewayError({
					class: "bad_request",
					message: `${config.label}: the videos transport only supports image references`,
					param: "input_references",
				});
			}
		}
		return mergeExtraBody(body, req.extraBody, [
			"model",
			"prompt",
			"input_reference",
			"seconds",
			"size",
			"quality",
			"seed",
			"generate_audio",
		]);
	}

	function buildAsyncVideosBody(
		req: CanonicalVideoRequest,
		ctx: AdapterContext,
	): Record<string, unknown> {
		const resolved = resolveVideoSize(req, videoProfileFor(ctx.meta));
		const body: Record<string, unknown> = {
			model: ctx.upstreamModel,
			prompt: req.prompt,
			...(req.seconds !== undefined ? { duration: Number(req.seconds) } : {}),
			// Prefer the native aspect_ratio/resolution form when the profile maps to it;
			// otherwise send exact pixel dimensions. The protocol treats the two forms as interchangeable.
			...(resolved?.aspectRatio || resolved?.resolution
				? {
						...(resolved.aspectRatio
							? { aspect_ratio: resolved.aspectRatio }
							: {}),
						...(resolved.resolution ? { resolution: resolved.resolution } : {}),
					}
				: resolved?.size !== undefined
					? { size: resolved.size }
					: {}),
			...(req.seed !== undefined ? { seed: req.seed } : {}),
			...(req.generateAudio !== undefined
				? { generate_audio: req.generateAudio }
				: {}),
		};
		const refs = req.inputReferences ?? [];
		if (refs.some((ref) => ref.type === "file_id")) {
			throw new GatewayError({
				class: "bad_request",
				message:
					"The async videos transport does not support file_id references",
				param: "input_references",
			});
		}
		const urlRefs = refs.filter(
			(ref): ref is VideoUrlReference => ref.type !== "file_id",
		);
		if (urlRefs.length > 0) {
			body.input_references = urlRefs.map((ref) =>
				ref.type === "image_url"
					? { type: "image_url", image_url: { url: ref.url } }
					: ref.type === "audio_url"
						? { type: "audio_url", audio_url: { url: ref.url } }
						: { type: "video_url", video_url: { url: ref.url } },
			);
		}
		if (req.frameImages && req.frameImages.length > 0) {
			body.frame_images = req.frameImages.map((frame) => ({
				type: "image_url",
				image_url: { url: frame.url },
				frame_type: frame.frame === "first" ? "first_frame" : "last_frame",
			}));
		}
		return mergeExtraBody(body, req.extraBody, [
			"model",
			"prompt",
			"duration",
			"size",
			"aspect_ratio",
			"resolution",
			"seed",
			"generate_audio",
			"input_references",
			"frame_images",
		]);
	}

	const videoGeneration: VideoHandler = {
		async submit(req, ctx) {
			const c = resolveCreds(ctx);
			if (ctx.transport === "videos_async") {
				return parseVideoJob(
					await fetchJson(
						{
							method: "POST",
							url: `${c.base}/videos`,
							headers: buildHeaders(c),
							body: JSON.stringify(buildAsyncVideosBody(req, ctx)),
						},
						ctx,
					),
					"videos_async",
				);
			}
			if (ctx.transport === "videos") {
				return parseVideoJob(
					await fetchJson(
						{
							method: "POST",
							url: `${c.base}/videos`,
							headers: buildHeaders(c),
							body: JSON.stringify(buildOpenAIVideoBody(req, ctx)),
						},
						ctx,
					),
					"videos",
				);
			}
			throw new GatewayError({
				class: "server",
				message: `${config.label}: transport "${ctx.transport}" cannot generate videos`,
			});
		},
		async refresh(job, ctx) {
			const c = resolveCreds(ctx);
			if (ctx.transport === "videos_async") {
				return parseVideoJob(
					await fetchJson(
						{
							method: "GET",
							url: `${c.base}/videos/${encodeURIComponent(job.upstreamJobId)}`,
							headers: buildAuthHeaders(c),
						},
						ctx,
					),
					"videos_async",
					job.upstreamJobId,
				);
			}
			if (ctx.transport === "videos") {
				return parseVideoJob(
					await fetchJson(
						{
							method: "GET",
							url: `${c.base}/videos/${encodeURIComponent(job.upstreamJobId)}`,
							headers: buildAuthHeaders(c),
						},
						ctx,
					),
					"videos",
					job.upstreamJobId,
				);
			}
			throw new GatewayError({
				class: "server",
				message: `${config.label}: transport "${ctx.transport}" cannot refresh videos`,
			});
		},
		async download(job: VideoJobRef, variant: VideoAssetVariant, ctx) {
			const c = resolveCreds(ctx);
			if (ctx.transport === "videos_async") {
				if (variant !== "video") {
					throw new GatewayError({
						class: "not_found",
						code: "video_variant_unavailable",
						message: `The async videos transport does not provide ${variant}`,
					});
				}
				return fetchContent(
					`${c.base}/videos/${encodeURIComponent(job.upstreamJobId)}/content?index=0`,
					buildAuthHeaders(c),
					ctx,
				);
			}
			if (ctx.transport === "videos") {
				return fetchContent(
					`${c.base}/videos/${encodeURIComponent(
						job.upstreamJobId,
					)}/content?variant=${encodeURIComponent(variant)}`,
					buildAuthHeaders(c),
					ctx,
				);
			}
			throw new GatewayError({
				class: "server",
				message: `${config.label}: transport "${ctx.transport}" cannot download videos`,
			});
		},
		async remove(job, ctx) {
			// Only the OpenAI-style dialect exposes a delete endpoint.
			if (ctx.transport !== "videos") return;
			const c = resolveCreds(ctx);
			await fetchJson(
				{
					method: "DELETE",
					url: `${c.base}/videos/${encodeURIComponent(job.upstreamJobId)}`,
					headers: buildAuthHeaders(c),
				},
				ctx,
			);
		},
		mapError(_err, _ctx) {
			return mapError(_err, _ctx);
		},
	};

	const audioTranscription: TranscriptionHandler = {
		async buildRequest(req, ctx) {
			const c = resolveCreds(ctx);
			return {
				method: "POST",
				url: `${c.base}/audio/transcriptions`,
				// No content-type: FormData sets the multipart boundary.
				headers: buildAuthHeaders(c),
				body: await buildTranscriptionForm(req, ctx.upstreamModel),
			};
		},
		parseResponse(raw) {
			return parseTranscriptionResponse(raw);
		},
		parseStream(stream, ctx) {
			return parseTranscriptionStream(stream, {
				onUnknownEvent: (type) =>
					recordUnknownAdapterEvent(adapterContextDiagnostics(ctx), type),
				onTransportTerminator: (terminator) => {
					adapterContextDiagnostics(ctx).transportTerminator = terminator;
				},
			});
		},
		mapError(err, ctx) {
			return mapError(err, ctx);
		},
	};

	const embeddings: EmbeddingsHandler = {
		buildRequest(req, ctx) {
			const c = resolveCreds(ctx);
			if (ctx.transport !== "embeddings") {
				throw new GatewayError({
					class: "server",
					message: `${config.label}: transport "${ctx.transport}" cannot create embeddings`,
				});
			}
			return {
				method: "POST",
				url: `${c.base}/embeddings`,
				headers: buildHeaders(c),
				body: JSON.stringify(buildEmbeddingsBody(req, ctx.upstreamModel)),
			};
		},
		parseResponse(raw) {
			return parseEmbeddingsResponse(raw);
		},
		mapError(err, ctx) {
			return mapError(err, ctx);
		},
	};

	const imageTransports = config.imageTransports;
	const videoTransports = config.videoTransports;
	const chatTransports = config.supportedChatTransports ?? [
		config.defaultTransport,
	];
	const contentInputs: NonNullable<Adapter["contentInputs"]> = {};
	for (const transport of chatTransports) {
		contentInputs[transport] = {
			// Both OpenAI text wires represent remote and inline images with the same URL field.
			image: { sources: ["url", "data_url"] },
			...(config.contentInputs?.[transport] ?? {}),
		};
	}
	if (!chatTransports.includes(config.defaultTransport)) {
		throw new Error(
			`${config.label}: default transport "${config.defaultTransport}" is not supported`,
		);
	}
	const supportedCallTypes = new Set<import("#core/callType.ts").CallType>([
		"chat",
	]);
	if (imageTransports && imageTransports.length > 0) {
		supportedCallTypes.add("images.generations");
		supportedCallTypes.add("images.edits");
	}
	if (videoTransports && videoTransports.length > 0)
		supportedCallTypes.add("videos.generations");
	if (config.audioTranscriptions)
		supportedCallTypes.add("audio.transcriptions");
	if (config.embeddings) supportedCallTypes.add("embeddings");
	const firstImageTransport = imageTransports?.[0];
	const imageTransportConfig =
		imageTransports && firstImageTransport
			? {
					supported: imageTransports,
					default: config.defaultImageTransport ?? firstImageTransport,
				}
			: undefined;
	const firstVideoTransport = videoTransports?.[0];
	const videoTransportConfig =
		videoTransports && firstVideoTransport
			? {
					supported: videoTransports,
					default: config.defaultVideoTransport ?? firstVideoTransport,
				}
			: undefined;

	return {
		key: config.key,
		credentials: {
			required: config.defaultBaseUrl ? ["apiKey"] : ["apiKey", "baseUrl"],
		},
		supportedCallTypes,
		chat,
		...(config.responsesWebSocket
			? {
					responsesWebSocket: makeOpenAIResponsesWebSocketHandler({
						label: config.label,
						resolveConnection(ctx) {
							const credentials = resolveCreds(ctx);
							return {
								url: credentials.base,
								headers: buildAuthHeaders(credentials),
							};
						},
						mapError(err, ctx) {
							return mapError(err, ctx);
						},
					}),
				}
			: {}),
		// The chat_completions transport emits reasoning_effort (openai_effort), top-level thinking
		// (openai_body), ignores fixed reasoners, and supports chat_template_kwargs.
		reasoningKinds: new Set<ReasoningControlKind>([
			"openai_effort",
			"openai_body",
			"fixed",
			"chat_template_flag",
		]),
		contentInputs,
		...(imageTransportConfig
			? {
					imageGeneration: makeImageHandler("generation"),
					imageEdit: makeImageHandler("edit"),
				}
			: {}),
		...(videoTransportConfig ? { videoGeneration } : {}),
		...(config.audioTranscriptions ? { audioTranscription } : {}),
		...(config.embeddings ? { embeddings } : {}),
		transports: {
			chat: { supported: chatTransports, default: config.defaultTransport },
			...(imageTransportConfig
				? {
						"images.generations": imageTransportConfig,
						"images.edits": imageTransportConfig,
					}
				: {}),
			...(videoTransportConfig
				? {
						"videos.generations": videoTransportConfig,
					}
				: {}),
			...(config.audioTranscriptions
				? {
						"audio.transcriptions": {
							supported: ["audio_transcriptions"],
							default: "audio_transcriptions",
						},
					}
				: {}),
			...(config.embeddings
				? {
						embeddings: {
							supported: ["embeddings"],
							default: "embeddings",
						},
					}
				: {}),
		},
	};
}
