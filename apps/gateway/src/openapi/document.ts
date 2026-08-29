/**
 * Builds the OpenAPI 3.1 document from the Zod component schemas. The result is serialized to
 * `openapi.yaml` by scripts/openapi-generate.ts and guarded against drift by openapi.test.ts, so the
 * spec is always generated from the same schemas the API speaks — never hand-maintained.
 */

import { createDocument, type ZodOpenApiRequestBodyObject } from "zod-openapi";
import * as c from "./components.ts";
import * as z from "zod/v4";

const errorResponse = { $ref: "#/components/responses/Error" } as const;
const rerankErrorResponse = {
	$ref: "#/components/responses/OpenRouterError",
} as const;
const cacheParams = [
	{ $ref: "#/components/parameters/CacheHeader" },
	{ $ref: "#/components/parameters/CacheTtlHeader" },
];

/** `{ data: [...], pagination }` envelope used by the paginated admin list endpoints. */
function paginated(item: z.ZodType) {
	return z.object({ data: z.array(item), pagination: c.Pagination });
}

const jsonBody = (
	schema: z.ZodType,
	examples?: Record<string, { value: unknown }>,
): ZodOpenApiRequestBodyObject => ({
	required: true,
	content: {
		"application/json": { schema, ...(examples ? { examples } : {}) },
	},
});

export function buildOpenApiDocument() {
	return createDocument({
		openapi: "3.1.0",
		info: {
			title: "Bifrost API",
			version: "1.0.0",
			description:
				"Provider-agnostic AI gateway with OpenAI/OpenResponses-compatible public contracts. " +
				"Importable in Postman, Insomnia, Bruno, and similar tools.\n\n" +
				"AUTHENTICATION: Bearer token (Authorization: Bearer <key>) or x-api-key header. " +
				"The master key is " +
				"required for /admin/*.\n\n" +
				"RESPONSE CONVENTIONS:\n" +
				"- Inference (/v1/chat/completions, /v1/responses, /v1/images/*, /v1/videos*, /v1/embeddings, /v1/rerank, " +
				"/v1/models): documented OpenAI/OpenResponses-compatible contracts with explicit native-only features.\n" +
				'- Management (/admin/*): envelope { "data": <object|array> }; lists: { "data": [...], ' +
				'"pagination": {...} }; delete: 204 with no body; error: { "error": {...} }.\n\n' +
				"RESPONSE HEADERS: x-request-id (all responses; echoed if sent on the request). " +
				"Virtual-key inference responses can also include " +
				"x-ratelimit-{limit,remaining,reset}-{requests,tokens,budget}.\n\n" +
				"REQUEST LIMITS: public JSON bodies are capped at 72 MiB, admin JSON at 2 MiB, rerank JSON at 16 MiB, and multipart endpoints publish their own aggregate caps. Oversized input returns 413.",
		},
		servers: [
			{
				url: "{baseUrl}",
				variables: { baseUrl: { default: "http://localhost:4000" } },
			},
		],
		security: [{ bearerAuth: [] }],
		tags: [{ name: "Inference" }, { name: "Admin" }, { name: "Health" }],
		components: {
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					description:
						"Master key or virtual key. Admin requires the master key. Alternative: x-api-key header.",
				},
			},
			parameters: {
				IdPath: {
					name: "id",
					in: "path",
					required: true,
					schema: { type: "string", format: "uuid" },
				},
				ResponseIdPath: {
					name: "id",
					in: "path",
					required: true,
					schema: { type: "string" },
					description: "OpenResponses response id (resp_...)",
				},
				VideoIdPath: {
					name: "id",
					in: "path",
					required: true,
					schema: { type: "string" },
					description: "Gateway video id (video_...)",
				},
				Limit: {
					name: "limit",
					in: "query",
					required: false,
					schema: { type: "integer", default: 50 },
				},
				Offset: {
					name: "offset",
					in: "query",
					required: false,
					schema: { type: "integer", default: 0 },
				},
				CacheHeader: {
					name: "x-unified-cache",
					in: "header",
					required: false,
					schema: { type: "string", enum: ["true", "1"] },
					description: "Opt-in response cache (non-stream, no tools).",
				},
				CacheTtlHeader: {
					name: "x-unified-cache-ttl",
					in: "header",
					required: false,
					schema: { type: "integer" },
					description: "Cache TTL in seconds (default 300).",
				},
			},
			responses: {
				Error: {
					description: "OpenAI-shaped error",
					content: { "application/json": { schema: c.ErrorSchema } },
				},
				OpenRouterError: {
					description: "OpenRouter-shaped rerank error",
					content: { "application/json": { schema: c.OpenRouterError } },
				},
			},
		},
		paths: {
			/* ------------------------------------------------------------ health */
			"/health/live": {
				get: {
					tags: ["Health"],
					summary: "Liveness (process only, no dependencies)",
					description:
						"Always 200 while the process is responsive. Does NOT check Postgres/Redis, so a dependency outage never triggers a restart. Wire this to the orchestrator's liveness probe.",
					security: [],
					responses: { "200": { description: "Process is alive" } },
				},
			},
			"/health/ready": {
				get: {
					tags: ["Health"],
					summary: "Readiness (DB + Redis + extensions)",
					description:
						"200 when Postgres, Redis and the extension runtime are healthy; otherwise 503 with a Retry-After header. Wire this to the readiness probe so a dependency outage pulls the instance from the load balancer without restarting it.",
					security: [],
					responses: {
						"200": { description: "Ready to serve traffic" },
						"503": { description: "Not ready (a dependency is down)" },
					},
				},
			},
			/* --------------------------------------------------------- inference */
			"/v1/chat/completions": {
				post: {
					tags: ["Inference"],
					summary: "Chat Completions (OpenAI-compatible, stream + no-stream)",
					parameters: cacheParams,
					requestBody: jsonBody(c.ChatCompletionRequest, {
						simple: {
							value: {
								model: "gemini",
								messages: [{ role: "user", content: "Hello, how are you?" }],
							},
						},
						streaming: {
							value: {
								model: "gemini",
								stream: true,
								stream_options: { include_usage: true },
								messages: [{ role: "user", content: "Count from 1 to 5" }],
							},
						},
					}),
					responses: {
						"200": {
							description:
								"chat.completion (or SSE stream of chat.completion.chunk)",
						},
						"400": errorResponse,
						"401": errorResponse,
						"403": errorResponse,
						"413": errorResponse,
						"429": errorResponse,
					},
				},
			},
			"/v1/responses": {
				get: {
					tags: ["Inference"],
					summary: "Responses WebSocket upgrade",
					description:
						"OpenAI/OpenResponses-compatible persistent WebSocket mode. Requires Upgrade: websocket. Client messages are top-level response.create JSON objects; server messages are response.* streaming event objects. Turns are sequential and the connection lifetime is 60 minutes.",
					responses: {
						"101": { description: "Switching Protocols" },
						"401": errorResponse,
						"429": errorResponse,
					},
				},
				post: {
					tags: ["Inference"],
					summary:
						"Responses (OpenResponses, provider-agnostic, stream + no-stream)",
					description:
						"This resource also supports OpenAI-compatible WebSocket upgrades with GET /v1/responses. Send response.create JSON events; the server returns the normal response.* streaming event objects. WebSocket turns are sequential and connections last at most 60 minutes.",
					parameters: cacheParams,
					requestBody: jsonBody(c.ResponsesRequest, {
						simple: {
							value: {
								model: "gemini",
								input: "Say hello in 3 words",
								instructions: "Be concise.",
							},
						},
						streaming: {
							value: {
								model: "gemini",
								stream: true,
								input: "Count from 1 to 5",
							},
						},
						pdf: {
							value: {
								model: "gemini",
								input: [
									{
										role: "user",
										content: [
											{
												type: "input_file",
												file_url: "https://assets.example/document.pdf",
											},
											{
												type: "input_text",
												text: "Summarize this document.",
											},
										],
									},
								],
								plugins: [{ id: "file-parser", pdf: { engine: "auto" } }],
							},
						},
					}),
					responses: {
						"200": {
							description: "response (or SSE stream of response.* events)",
							content: {
								"application/json": { schema: c.ResponseObject },
								"text/event-stream": { schema: z.string() },
							},
						},
						"400": errorResponse,
						"413": errorResponse,
					},
				},
			},
			"/v1/responses/compact": {
				post: {
					tags: ["Inference"],
					summary: "Compact a Responses conversation",
					description:
						"Produces a provider-agnostic response.compaction item that can be replayed through the gateway.",
					requestBody: jsonBody(c.CompactResponseRequest),
					responses: {
						"200": {
							description: "Compacted response",
							content: {
								"application/json": { schema: c.CompactResponseObject },
							},
						},
						"400": errorResponse,
						"401": errorResponse,
						"413": errorResponse,
						"429": errorResponse,
					},
				},
			},
			"/v1/responses/{id}": {
				get: {
					tags: ["Inference"],
					summary: "Retrieve a stored response (server-side store)",
					description:
						"Returns the stored canonical `response` object when store=true. Scope is per key: a virtual key only sees its own responses; the master key sees responses created with the master key.",
					parameters: [{ $ref: "#/components/parameters/ResponseIdPath" }],
					responses: {
						"200": {
							description: "response object (OpenResponses contract)",
							content: {
								"application/json": { schema: c.ResponseObject },
							},
						},
						"404": errorResponse,
					},
				},
				delete: {
					tags: ["Inference"],
					summary: "Delete a stored response",
					parameters: [{ $ref: "#/components/parameters/ResponseIdPath" }],
					responses: {
						"200": {
							description: "{ id, object: 'response.deleted', deleted: true }",
						},
						"404": errorResponse,
					},
				},
			},
			"/v1/responses/{id}/input_items": {
				get: {
					tags: ["Inference"],
					summary: "List input items for a stored response",
					parameters: [{ $ref: "#/components/parameters/ResponseIdPath" }],
					responses: {
						"200": {
							description:
								"{ object: 'list', data: [...], first_id, last_id, has_more }",
						},
						"404": errorResponse,
					},
				},
			},
			"/v1/messages": {
				post: {
					tags: ["Inference"],
					summary:
						"Anthropic Messages API (provider-agnostic, stream + no-stream)",
					description:
						"Anthropic-compatible Messages contract, serviceable by any provider through the canonical hub. Native-only fields are routed only to a messages transport; errors and SSE events use the Anthropic format.",
					requestBody: jsonBody(c.MessagesRequest, {
						simple: {
							value: {
								model: "claude",
								max_tokens: 1024,
								system: "Be concise.",
								messages: [{ role: "user", content: "Hello" }],
							},
						},
						streaming: {
							value: {
								model: "claude",
								max_tokens: 1024,
								stream: true,
								messages: [{ role: "user", content: "Count from 1 to 5" }],
							},
						},
					}),
					responses: {
						"200": {
							description:
								"message (or SSE stream: message_start, content_block_*, message_delta, message_stop)",
						},
						"400": {
							description: "{ type: 'error', error: {...} } (Anthropic shape)",
						},
						"413": {
							description:
								"Request body exceeds the public JSON limit (Anthropic error shape)",
						},
					},
				},
			},
			"/v1/messages/count_tokens": {
				post: {
					operationId: "countMessageTokens",
					tags: ["Inference"],
					summary: "Count input tokens for an Anthropic Messages request",
					description:
						"Uses a native provider counter when the selected model exposes one; otherwise returns a deterministic portable estimate. Errors use the Anthropic envelope.",
					requestBody: jsonBody(c.MessagesTokenCountRequest, {
						simple: {
							value: {
								model: "claude",
								messages: [{ role: "user", content: "Hello" }],
							},
						},
					}),
					responses: {
						"200": {
							description: "Input token count",
							content: {
								"application/json": {
									schema: c.MessagesTokenCountResponse,
								},
							},
						},
						"400": {
							description: "Anthropic error envelope",
						},
					},
				},
			},
			"/v1/embeddings": {
				post: {
					operationId: "createEmbedding",
					tags: ["Inference"],
					summary: "Create embeddings (OpenAI contract, no-stream)",
					description:
						"Accepts a string input, a string batch, tokens, or a tokenized batch. Routes the embeddings operation to OpenAI/OpenAI-compatible providers or Google AI Studio, with opt-in response caching through x-unified-cache. Each model validates its own profile: for example, Google AI Studio accepts text + float only, without tokenized input or base64.",
					parameters: cacheParams,
					requestBody: jsonBody(c.EmbeddingsRequest, {
						simple: {
							value: {
								model: "text-embedding-3-small",
								input: "The food was delicious",
								encoding_format: "float",
							},
						},
						batch: {
							value: {
								model: "text-embedding-3-small",
								input: ["red fox", "blue whale"],
								dimensions: 512,
							},
						},
					}),
					responses: {
						"200": {
							description: "CreateEmbeddingResponse",
							content: { "application/json": { schema: c.EmbeddingsResponse } },
						},
						"400": errorResponse,
						"401": errorResponse,
						"403": errorResponse,
						"413": errorResponse,
						"429": errorResponse,
					},
				},
			},
			"/v1/audio/transcriptions": {
				post: {
					operationId: "createTranscription",
					tags: ["Inference"],
					summary: "Transcribe audio (OpenAI-compatible multipart contract)",
					description:
						"Accepts one audio file plus transcription controls. JSON and verbose_json return JSON, text/srt/vtt return text, and stream=true returns OpenAI-compatible transcription SSE events.",
					requestBody: {
						required: true,
						content: {
							"multipart/form-data": { schema: c.AudioTranscriptionRequest },
						},
					},
					responses: {
						"200": {
							description: "Transcription JSON, text, subtitles, or SSE stream",
							content: {
								"application/json": { schema: c.AudioTranscriptionResponse },
								"text/plain": { schema: z.string() },
								"text/event-stream": { schema: z.string() },
							},
						},
						"400": errorResponse,
						"401": errorResponse,
						"403": errorResponse,
						"413": errorResponse,
						"429": errorResponse,
					},
				},
			},
			"/v1/rerank": {
				post: {
					operationId: "rerank",
					tags: ["Inference"],
					summary: "Rerank documents (OpenRouter contract, no-stream)",
					description:
						"Ranks 1-1000 text documents against a query. Requests route across OpenRouter and Vercel AI Gateway unless OpenRouter provider preferences are supplied, in which case only OpenRouter-backed deployments are eligible. Result documents are reconstructed from the request and response caching is disabled.",
					requestBody: jsonBody(c.RerankRequest, {
						mixedDocuments: {
							value: {
								model: "cohere/rerank-v3.5",
								query: "What is the capital of France?",
								documents: [
									"Paris is the capital of France.",
									{ text: "Berlin is the capital of Germany." },
								],
								top_n: 2,
							},
						},
					}),
					responses: {
						"200": {
							description: "OpenRouter-shaped rerank response",
							content: { "application/json": { schema: c.RerankResponse } },
						},
						"400": rerankErrorResponse,
						"401": rerankErrorResponse,
						"403": rerankErrorResponse,
						"413": rerankErrorResponse,
						"429": rerankErrorResponse,
						"500": rerankErrorResponse,
						"502": rerankErrorResponse,
						"503": rerankErrorResponse,
					},
				},
			},
			"/v1/images/generations": {
				post: {
					operationId: "createImageGeneration",
					tags: ["Inference"],
					summary: "Generate images (OpenAI Images contract, JSON or SSE)",
					description:
						"Routes images.generations to OpenAI Images, compatible APIs, Gemini generateContent, or multimodal chat_completions models. Parameters are validated against the model profile.",
					requestBody: jsonBody(c.ImageGenerationRequest, {
						gptImage: {
							value: {
								model: "gpt-image",
								prompt: "A tiny astronaut in a botanical garden",
								size: "1024x1024",
								quality: "high",
							},
						},
					}),
					responses: {
						"200": {
							description:
								"ImagesResponse JSON, or SSE events image_generation.partial_image/completed",
							content: { "application/json": { schema: c.ImagesResponse } },
						},
						"400": errorResponse,
						"401": errorResponse,
						"403": errorResponse,
						"413": errorResponse,
						"429": errorResponse,
					},
				},
			},
			"/v1/images/edits": {
				post: {
					operationId: "createImageEdit",
					tags: ["Inference"],
					summary: "Edit images (multipart; OpenAI Images contract)",
					description:
						"Accepts up to 16 `image`/`image[]` parts, an optional PNG mask, and `extra_body` as a JSON string. Uploads are validated and stored temporarily during the request.",
					requestBody: {
						required: true,
						content: {
							"multipart/form-data": {
								schema: c.ImageEditRequest,
								encoding: {
									image: { contentType: "image/png, image/jpeg, image/webp" },
									mask: { contentType: "image/png" },
								},
							},
						},
					},
					responses: {
						"200": {
							description:
								"ImagesResponse JSON, or SSE events image_edit.partial_image/completed",
							content: { "application/json": { schema: c.ImagesResponse } },
						},
						"400": errorResponse,
						"401": errorResponse,
						"403": errorResponse,
						"413": errorResponse,
						"429": errorResponse,
					},
				},
			},
			"/v1/videos": {
				post: {
					operationId: "createVideo",
					tags: ["Inference"],
					summary: "Create a video generation job",
					description:
						"Async video creation. The gateway routes submission to a video-capable deployment, stores local metadata, polls the upstream job, and persists completed video bytes in object storage for 24 hours. Accepts OpenAI-style aliases (seconds, size, input_reference).",
					requestBody: jsonBody(c.VideoCreateRequest, {
						native: {
							value: {
								model: "veo",
								prompt: "A serene mountain landscape at sunset",
								duration: 8,
								aspect_ratio: "16:9",
								resolution: "720p",
							},
						},
						openaiCompatible: {
							value: {
								model: "sora",
								prompt: "A serene mountain landscape at sunset",
								seconds: "8",
								size: "1280x720",
							},
						},
					}),
					responses: {
						"200": {
							description: "Video object",
							content: { "application/json": { schema: c.VideoObject } },
						},
						"400": errorResponse,
						"401": errorResponse,
						"403": errorResponse,
						"413": errorResponse,
						"429": errorResponse,
						"503": errorResponse,
					},
				},
				get: {
					operationId: "listVideos",
					tags: ["Inference"],
					summary: "List videos",
					parameters: [
						{
							name: "after",
							in: "query",
							required: false,
							schema: { type: "string" },
						},
						{
							name: "limit",
							in: "query",
							required: false,
							schema: { type: "integer", minimum: 0, maximum: 100 },
						},
						{
							name: "order",
							in: "query",
							required: false,
							schema: { type: "string", enum: ["asc", "desc"] },
						},
					],
					responses: {
						"200": {
							description: "Video list",
							content: { "application/json": { schema: c.VideoListResponse } },
						},
						"401": errorResponse,
					},
				},
			},
			"/v1/videos/{id}": {
				get: {
					operationId: "retrieveVideo",
					tags: ["Inference"],
					summary: "Retrieve a video",
					parameters: [{ $ref: "#/components/parameters/VideoIdPath" }],
					responses: {
						"200": {
							description: "Video object",
							content: { "application/json": { schema: c.VideoObject } },
						},
						"401": errorResponse,
						"404": errorResponse,
					},
				},
				delete: {
					operationId: "deleteVideo",
					tags: ["Inference"],
					summary: "Delete a video and its stored assets",
					parameters: [{ $ref: "#/components/parameters/VideoIdPath" }],
					responses: {
						"200": {
							description: "Deleted video marker",
							content: { "application/json": { schema: c.VideoDeleted } },
						},
						"401": errorResponse,
						"404": errorResponse,
					},
				},
			},
			"/v1/videos/{id}/content": {
				get: {
					operationId: "downloadVideoContent",
					tags: ["Inference"],
					summary: "Download generated video content",
					parameters: [
						{ $ref: "#/components/parameters/VideoIdPath" },
						{
							name: "variant",
							in: "query",
							required: false,
							schema: {
								type: "string",
								enum: ["video", "thumbnail", "spritesheet"],
								default: "video",
							},
						},
					],
					responses: {
						"200": {
							description: "Video or preview bytes",
							content: {
								"video/mp4": { schema: { type: "string", format: "binary" } },
							},
						},
						"206": { description: "Partial content for byte-range requests" },
						"400": errorResponse,
						"401": errorResponse,
						"404": errorResponse,
						"409": errorResponse,
					},
				},
			},
			"/v1/models": {
				get: {
					tags: ["Inference"],
					security: [],
					summary: "List public models (unauthenticated)",
					description:
						"OpenAI-compatible base fields plus capability metadata aggregated from enabled deployments. Does not expose deployment labels, credentials, or upstream model ids.",
					responses: {
						"200": {
							description:
								"{ object: 'list', data: [{ id, object, created, owned_by, architecture, top_provider, pricing, operations, supported_parameters, endpoint_count }] }",
						},
					},
				},
			},
			"/v1/models/{model}": {
				get: {
					tags: ["Inference"],
					security: [],
					summary: "Retrieve a public model (unauthenticated)",
					description:
						"Supports model ids containing slashes. Returns the same public capability shape as /v1/models.",
					parameters: [
						{
							name: "model",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					responses: {
						"200": {
							description: "{ id, object: 'model', created, owned_by }",
						},
						"404": errorResponse,
					},
				},
			},
			"/v1/models/{model}/deployments": {
				get: {
					tags: ["Inference"],
					security: [],
					summary: "List redacted deployments for a public model",
					description:
						"Redacted endpoint data for each enabled deployment. Public response redacts database ids, operator labels, credentials, metadata, and upstream model ids.",
					parameters: [
						{
							name: "model",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					responses: {
						"200": {
							description:
								"{ object: 'list', data: [{ id, object: 'model.deployment', model, provider, status, retry_after_ms, top_provider, pricing, operations, supported_parameters, metrics }] }",
						},
						"404": errorResponse,
					},
				},
			},
			/* ------------------------------------------------------------- admin */
			"/admin/operations": {
				get: {
					tags: ["Admin"],
					operationId: "listOperations",
					summary:
						"Discover available operations, endpoints, and transports by adapter",
					responses: {
						"200": { description: "Operation and adapter registry" },
						"401": errorResponse,
					},
				},
			},
			"/admin/deployments/resolve": {
				post: {
					tags: ["Admin"],
					operationId: "resolveDeployment",
					summary: "Resolve profile, operations, and transports without saving",
					description:
						"Validates adapter, catalog/custom model metadata, operation profiles, and transports without saving. Credentials are accepted for body reuse and ignored.",
					requestBody: jsonBody(c.ResolveDeployment),
					responses: {
						"200": { description: "Effective deployment configuration" },
						"400": errorResponse,
					},
				},
			},
			"/admin/deployments": {
				get: {
					tags: ["Admin"],
					operationId: "listDeployments",
					summary: "List deployments (master key, paginated)",
					parameters: [
						{ $ref: "#/components/parameters/Limit" },
						{ $ref: "#/components/parameters/Offset" },
					],
					responses: {
						"200": {
							description: "Paginated deployments (without credentials)",
							content: {
								"application/json": { schema: paginated(z.unknown()) },
							},
						},
						"401": errorResponse,
					},
				},
				post: {
					tags: ["Admin"],
					operationId: "createDeployment",
					summary: "Create a deployment with the API key inline",
					description:
						"Creates a deployment: public name (`publicModel`) + adapter + exact upstream model + inline credentials. Multiple deployments with the same `publicModel` form a balanced pool.",
					requestBody: jsonBody(c.CreateDeployment, {
						gptImage: {
							value: {
								publicModel: "gpt-image",
								adapterKey: "openai",
								upstreamModel: "gpt-image-2",
								credentials: { apiKey: "sk-..." },
							},
						},
						customCompatible: {
							value: {
								publicModel: "grok",
								adapterKey: "openaicompatible",
								upstreamModel: "grok-4",
								credentials: {
									apiKey: "xai-...",
									baseUrl: "https://api.x.ai/v1",
								},
							},
						},
					}),
					responses: {
						"201": {
							description:
								"Deployment created and resolved; credentials are never returned",
						},
						"400": errorResponse,
					},
				},
			},
			"/admin/deployments/{id}": {
				parameters: [{ $ref: "#/components/parameters/IdPath" }],
				get: {
					tags: ["Admin"],
					operationId: "retrieveDeployment",
					summary: "Retrieve a deployment (without credentials)",
					responses: {
						"200": { description: "Deployment" },
						"404": errorResponse,
					},
				},
				patch: {
					tags: ["Admin"],
					operationId: "updateDeployment",
					summary:
						"Update upstreamModel, credentials, catalogEntry, pricing, transportOverrides, or routing",
					requestBody: jsonBody(c.UpdateDeployment),
					responses: {
						"200": { description: "Deployment updated and resolved" },
						"404": errorResponse,
					},
				},
				delete: {
					tags: ["Admin"],
					operationId: "deleteDeployment",
					summary: "Delete a deployment",
					responses: {
						"204": { description: "No Content" },
						"404": errorResponse,
					},
				},
			},
			"/admin/keys": {
				get: {
					tags: ["Admin"],
					summary: "List virtual keys (master key, paginated)",
					parameters: [
						{ $ref: "#/components/parameters/Limit" },
						{ $ref: "#/components/parameters/Offset" },
						{ name: "enabled", in: "query", schema: { type: "boolean" } },
						{
							name: "publicModel",
							in: "query",
							schema: { type: "string" },
							description: "Keys with access to this Public Model",
						},
						{
							name: "q",
							in: "query",
							schema: { type: "string" },
							description: "Search in name/prefix",
						},
					],
					responses: {
						"200": {
							description: "Paginated virtual keys",
							content: {
								"application/json": { schema: paginated(z.unknown()) },
							},
						},
					},
				},
				post: {
					tags: ["Admin"],
					summary: "Create virtual key (returns the plaintext key ONCE)",
					requestBody: jsonBody(c.CreateKey, {
						scoped: {
							value: {
								name: "app-frontend",
								allowedModels: ["gemini", "gpt"],
								maxBudgetCents: 500,
								budgetReset: "monthly",
								rpm: 60,
							},
						},
						unlimited: { value: { name: "full-access", allowedModels: [] } },
					}),
					responses: {
						"201": { description: "{ data: { ...key, key: '<rawKey>' } }" },
					},
				},
			},
			"/admin/keys/{id}": {
				patch: {
					tags: ["Admin"],
					summary: "Edit virtual key (master key)",
					parameters: [{ $ref: "#/components/parameters/IdPath" }],
					requestBody: jsonBody(c.UpdateKey, {
						disable: { value: { enabled: false } },
						raiseBudget: { value: { maxBudgetCents: 2000 } },
						resetSpend: { value: { resetSpend: true } },
					}),
					responses: {
						"200": { description: "{ data: <key> }" },
						"404": errorResponse,
					},
				},
				delete: {
					tags: ["Admin"],
					summary: "Delete virtual key (master key)",
					parameters: [{ $ref: "#/components/parameters/IdPath" }],
					responses: { "204": { description: "No Content" } },
				},
			},
			"/admin/cache": {
				delete: {
					tags: ["Admin"],
					summary: "Invalidate response cache (master key)",
					parameters: [
						{
							name: "callType",
							in: "query",
							schema: { type: "string" },
							description: "e.g. chat | responses (default: all)",
						},
						{
							name: "namespace",
							in: "query",
							schema: { type: "string" },
							description: "virtual key id or 'master' (default: all)",
						},
					],
					responses: { "200": { description: "{ data: { deleted: <n> } }" } },
				},
			},
			"/admin/extensions": {
				get: {
					tags: ["Admin"],
					summary:
						"Inspect the runtime extension state of this process (master key, read-only)",
					responses: {
						"200": {
							description:
								"{ data: { loaded, status, healthy, definitions, instances } }",
						},
					},
				},
			},
			"/admin/extensions/artifacts": {
				get: {
					tags: ["Admin"],
					summary:
						"List uploaded extension artifacts (all keys and versions, no code)",
					responses: {
						"200": {
							description:
								"{ data: [{ id, key, version, contentHash, sizeBytes, status, uploadedBy, createdAt }] }",
						},
					},
				},
				post: {
					tags: ["Admin"],
					summary:
						"Upload a new extension version and make it active (master key)",
					description:
						"The module source is validated (imported and checked for a valid definition whose key matches) before it is stored, so an invalid upload is rejected with 400 and never reaches the fleet.",
					requestBody: jsonBody(
						z.object({
							key: z.string().regex(/^[a-z0-9]+$/),
							code: z.string().meta({ description: "ESM module source" }),
						}),
					),
					responses: {
						"201": { description: "{ data: <artifact summary> }" },
						"400": errorResponse,
					},
				},
			},
			"/admin/extensions/artifacts/{key}/versions": {
				get: {
					tags: ["Admin"],
					summary: "Version history for one definition (master key)",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					responses: {
						"200": { description: "{ data: [<artifact summary>] }" },
					},
				},
			},
			"/admin/extensions/artifacts/{key}/activate": {
				post: {
					tags: ["Admin"],
					summary:
						"Activate a specific version, archiving the rest (rollback, master key)",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					requestBody: jsonBody(z.object({ version: z.int().min(1) })),
					responses: {
						"200": { description: "{ data: [<artifact summary>] }" },
						"404": errorResponse,
					},
				},
			},
			"/admin/extensions/artifacts/{key}": {
				delete: {
					tags: ["Admin"],
					summary: "Remove every version of a definition (master key)",
					parameters: [
						{
							name: "key",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					responses: { "204": { description: "Deleted (idempotent)" } },
				},
			},
			"/admin/extensions/instances": {
				get: {
					tags: ["Admin"],
					summary: "List extension instances (master key)",
					responses: { "200": { description: "{ data: [<instance>] }" } },
				},
				post: {
					tags: ["Admin"],
					summary: "Create an extension instance (master key)",
					requestBody: jsonBody(
						z.object({
							id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
							definition: z.string().regex(/^[a-z0-9]+$/),
							enabled: z.boolean().optional(),
							critical: z.union([z.boolean(), z.null()]).optional(),
							priority: z.int().optional(),
							match: z.record(z.string(), z.unknown()).optional(),
							config: z.unknown().optional(),
						}),
					),
					responses: {
						"201": { description: "{ data: <instance> }" },
						"400": errorResponse,
					},
				},
			},
			"/admin/extensions/instances/{id}": {
				patch: {
					tags: ["Admin"],
					summary: "Update an extension instance (master key)",
					parameters: [
						{
							name: "id",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					requestBody: jsonBody(
						z.object({
							definition: z
								.string()
								.regex(/^[a-z0-9]+$/)
								.optional(),
							enabled: z.boolean().optional(),
							critical: z.union([z.boolean(), z.null()]).optional(),
							priority: z.int().optional(),
							match: z.record(z.string(), z.unknown()).optional(),
							config: z.unknown().optional(),
						}),
					),
					responses: {
						"200": { description: "{ data: <instance> }" },
						"404": errorResponse,
					},
				},
				delete: {
					tags: ["Admin"],
					summary: "Delete an extension instance (master key)",
					parameters: [
						{
							name: "id",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					responses: { "204": { description: "Deleted (idempotent)" } },
				},
			},
			"/admin/extensions/{id}/reset": {
				post: {
					tags: ["Admin"],
					summary:
						"Clear a circuit-breaker trip and re-activate an instance (master key)",
					parameters: [
						{
							name: "id",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
					],
					responses: {
						"200": { description: "{ data: <extension status> }" },
						"400": errorResponse,
						"404": errorResponse,
					},
				},
			},
			"/admin/logs": {
				get: {
					tags: ["Admin"],
					summary:
						"List gateway operations (master key, paginated, newest first)",
					parameters: [
						{ $ref: "#/components/parameters/Limit" },
						{ $ref: "#/components/parameters/Offset" },
						{
							name: "virtualKeyId",
							in: "query",
							schema: { type: "string", format: "uuid" },
						},
						{ name: "publicModel", in: "query", schema: { type: "string" } },
						{
							name: "deploymentId",
							in: "query",
							schema: { type: "string", format: "uuid" },
						},
						{ name: "adapterKey", in: "query", schema: { type: "string" } },
						{
							name: "callType",
							in: "query",
							schema: { type: "string" },
							description: "chat | responses | messages",
						},
						{
							name: "outcome",
							in: "query",
							schema: {
								type: "string",
								enum: [
									"success",
									"incomplete",
									"blocked",
									"error",
									"cancelled",
									"abandoned",
									"unknown",
								],
							},
						},
						{ name: "degraded", in: "query", schema: { type: "boolean" } },
						{ name: "active", in: "query", schema: { type: "boolean" } },
						{
							name: "terminalVerified",
							in: "query",
							schema: { type: "boolean" },
						},
						{ name: "failureKind", in: "query", schema: { type: "string" } },
						{ name: "failurePhase", in: "query", schema: { type: "string" } },
						{
							name: "minDurationMs",
							in: "query",
							schema: { type: "number", minimum: 0 },
						},
						{
							name: "maxDurationMs",
							in: "query",
							schema: { type: "number", minimum: 0 },
						},
						{ name: "requestId", in: "query", schema: { type: "string" } },
						{ name: "cacheHit", in: "query", schema: { type: "boolean" } },
						{
							name: "start",
							in: "query",
							schema: { type: "string", format: "date-time" },
							description: "start_time >= (narrows partitions)",
						},
						{
							name: "end",
							in: "query",
							schema: { type: "string", format: "date-time" },
							description: "start_time <=",
						},
					],
					responses: {
						"200": {
							description: "{ data: [<operation>], pagination: {...} }",
						},
						"400": errorResponse,
					},
				},
			},
			"/admin/logs/{id}": {
				get: {
					tags: ["Admin"],
					summary: "Get one gateway operation and all upstream attempts",
					parameters: [
						{
							name: "id",
							in: "path",
							required: true,
							schema: { type: "string", format: "uuid" },
						},
					],
					responses: {
						"200": { description: "Operation detail" },
						"404": errorResponse,
					},
				},
			},
			"/admin/logs/{id}/payload": {
				get: {
					tags: ["Admin"],
					summary: "Decrypt a retained forensic payload sample",
					parameters: [
						{
							name: "id",
							in: "path",
							required: true,
							schema: { type: "string", format: "uuid" },
						},
					],
					responses: {
						"200": { description: "Decrypted sample" },
						"404": errorResponse,
					},
				},
			},
			"/admin/observability/summary": {
				get: {
					tags: ["Admin"],
					summary: "Aggregate gateway lifecycle health",
					parameters: [
						{
							name: "window",
							in: "query",
							schema: {
								type: "string",
								enum: ["5m", "1h", "24h"],
								default: "1h",
							},
						},
					],
					responses: { "200": { description: "Lifecycle SLI summary" } },
				},
			},
			"/admin/usage": {
				get: {
					tags: ["Admin"],
					summary:
						"Aggregate usage (requests, tokens, search units, cost), optionally grouped (master key)",
					description:
						"Sums consumer usage/cost and estimated upstream cost over gateway operations. Accepts the same filters as /admin/logs. groupBy=none returns a single total.",
					parameters: [
						{
							name: "groupBy",
							in: "query",
							required: false,
							schema: {
								type: "string",
								enum: ["public_model", "virtual_key", "day", "none"],
								default: "none",
							},
						},
						{
							name: "virtualKeyId",
							in: "query",
							schema: { type: "string", format: "uuid" },
						},
						{ name: "publicModel", in: "query", schema: { type: "string" } },
						{ name: "adapterKey", in: "query", schema: { type: "string" } },
						{ name: "callType", in: "query", schema: { type: "string" } },
						{
							name: "outcome",
							in: "query",
							schema: { type: "string" },
						},
						{ name: "cacheHit", in: "query", schema: { type: "boolean" } },
						{
							name: "start",
							in: "query",
							schema: { type: "string", format: "date-time" },
						},
						{
							name: "end",
							in: "query",
							schema: { type: "string", format: "date-time" },
						},
					],
					responses: {
						"200": {
							description:
								"{ data: [{ key, requests, promptTokens, completionTokens, reasoningTokens, totalTokens, searchUnits, consumerCostCents, upstreamCostCents }] }",
						},
						"400": errorResponse,
					},
				},
			},
			"/admin/router-settings": {
				get: {
					tags: ["Admin"],
					summary: "View router config (master key)",
					responses: { "200": { description: "{ data: <settings|null> }" } },
				},
				put: {
					tags: ["Admin"],
					summary: "Update router config (master key)",
					requestBody: jsonBody(c.RouterSettings),
					responses: { "200": { description: "{ data: <settings> }" } },
				},
			},
			"/admin/fallbacks": {
				get: {
					tags: ["Admin"],
					summary: "List fallbacks (master key)",
					responses: { "200": { description: "{ data: [...] }" } },
				},
				put: {
					tags: ["Admin"],
					summary: "Create/update dedicated fallback (master key)",
					description:
						"Configures an exact chain by (primaryModel, reason). Public Models must exist and each target must share at least one executable operation with the primary. The router exhausts the primary deployments before traversing the chain.",
					requestBody: jsonBody(c.Fallback, {
						general: {
							value: {
								primaryModel: "gpt",
								fallbackModels: ["gemini"],
								reason: "general",
							},
						},
					}),
					responses: {
						"201": { description: "{ data: <fallback> }" },
						"400": errorResponse,
					},
				},
			},
			"/admin/fallbacks/{primaryModel}/{reason}": {
				delete: {
					tags: ["Admin"],
					summary: "Delete fallback (master key)",
					parameters: [
						{
							name: "primaryModel",
							in: "path",
							required: true,
							schema: { type: "string" },
						},
						{
							name: "reason",
							in: "path",
							required: true,
							schema: {
								type: "string",
								enum: ["general", "context_window", "content_policy"],
							},
						},
					],
					responses: { "204": { description: "No Content" } },
				},
			},
		},
	});
}
