import { cacheUsage } from "#admin/metricsSchema.ts";

import {
	promptCacheRetentionSchema,
	promptCacheOptionsSchema,
} from "#contracts/openai/promptCache.ts";

/**
 * OpenAPI component schemas, defined as Zod so the spec is generated — never hand-maintained.
 *
 * These mirror the public HTTP contracts. Most inference bodies (chat/responses/messages/embeddings/
 * images) are intentionally loose (`additionalProperties: true`) because the gateway forwards
 * provider-specific extras; the admin bodies are strict and kept in lock-step with the runtime Zod
 * validators by a conformance test (see openapi.test.ts). `.meta({ id })` registers a schema as a
 * reusable `#/components/schemas/<id>` entry.
 */

import "zod-openapi"; // ambient types for `.meta({ id, ... })`

import { EXECUTION_POLICY_MAX_TOTAL_MS } from "#core/executionPolicy.ts";
import { transcriptionFieldsSchema } from "#contracts/openai/audio.ts";
import { rerankRequestSchema } from "#contracts/openrouter/rerank.ts";
import { OPERATION_IDS } from "#operations/registry.ts";
import { CALL_TYPE_VALUES } from "#core/callType.ts";
import { pricingSchema } from "#profiles/schema.ts";
import { EFFORT_ORDER } from "#core/reasoning.ts";
import * as z from "zod/v4";

/** An object that accepts arbitrary extra keys (`additionalProperties: true`). */
function loose(shape: z.ZodRawShape, meta: Record<string, unknown>): z.ZodType {
	return z
		.object(shape)
		.meta({ override: { additionalProperties: true }, ...meta });
}

const nullableString = z.union([z.string(), z.null()]);
const nullableInteger = z.union([z.int(), z.null()]);
const reasoningEffort = z.enum(EFFORT_ORDER);
const reasoningConfig = loose(
	{
		effort: reasoningEffort.optional(),
		summary: z.enum(["auto", "none", "concise", "detailed"]).optional(),
	},
	{},
);

export const AudioTranscriptionRequest = transcriptionFieldsSchema
	.extend({ file: z.file() })
	.meta({ id: "AudioTranscriptionRequest" });

export const AudioTranscriptionResponse = loose(
	{
		text: z.string(),
		language: z.string().optional(),
		duration: z.number().optional(),
		words: z.array(z.record(z.string(), z.unknown())).optional(),
		segments: z.array(z.record(z.string(), z.unknown())).optional(),
		usage: z.record(z.string(), z.unknown()).optional(),
	},
	{ id: "AudioTranscriptionResponse" },
);

/* ------------------------------------------------------------------ shared */

export const ErrorSchema = z
	.object({
		error: z.object({
			message: z.string(),
			type: z.string(),
			param: nullableString.optional(),
			code: nullableString.optional(),
		}),
	})
	.meta({ id: "Error" });

export const Pagination = z
	.object({
		limit: z.int(),
		offset: z.int(),
		total: z.int(),
		nextOffset: nullableInteger,
	})
	.meta({ id: "Pagination" });

export const JsonSchemaDefinition = z.record(z.string(), z.unknown()).meta({
	id: "JsonSchemaDefinition",
	description: "JSON Schema the model output must satisfy.",
});

/* ------------------------------------------------- inference: response format */

const textFormat = z.object({ type: z.literal("text") });
const jsonObjectFormat = z.object({ type: z.literal("json_object") });

export const ChatResponseFormat = z
	.union([
		textFormat,
		jsonObjectFormat,
		z.object({
			type: z.literal("json_schema"),
			json_schema: z.object({
				name: z.string(),
				description: z.string().optional(),
				schema: JsonSchemaDefinition.optional(),
				strict: z.union([z.boolean(), z.null()]).optional(),
			}),
		}),
	])
	.meta({ id: "ChatResponseFormat" });

export const ResponsesTextFormat = z
	.union([
		textFormat,
		jsonObjectFormat,
		z.object({
			type: z.literal("json_schema"),
			name: z.string(),
			description: z.string().optional(),
			schema: JsonSchemaDefinition,
			strict: z.union([z.boolean(), z.null()]).optional(),
		}),
	])
	.meta({ id: "ResponsesTextFormat" });

export const ResponsesTextConfig = loose(
	{ format: ResponsesTextFormat.optional() },
	{ id: "ResponsesTextConfig" },
);

export const MessagesOutputConfig = loose(
	{
		effort: z
			.union([z.enum(["low", "medium", "high", "xhigh", "max"]), z.null()])
			.optional(),
		format: z
			.object({
				type: z.literal("json_schema"),
				schema: JsonSchemaDefinition,
			})
			.optional(),
	},
	{ id: "MessagesOutputConfig" },
);

export const FileParserPlugin = loose(
	{
		id: z.literal("file-parser"),
		enabled: z.boolean().optional(),
		pdf: loose(
			{
				engine: z.enum(["auto", "native", "pdf-text"]).optional(),
			},
			{},
		).optional(),
	},
	{
		id: "FileParserPlugin",
		description:
			"Request-scoped file portability. auto prefers native handling; pdf-text extracts UTF-8 text locally.",
	},
);

/* ------------------------------------------------------ inference: requests */

export const ChatCompletionRequest = loose(
	{
		model: z.string().meta({ description: "public model (public_model)" }),
		messages: z.array(
			loose(
				{
					role: z.enum(["system", "developer", "user", "assistant", "tool"]),
					content: z.unknown().optional(),
				},
				{},
			),
		),
		stream: z.boolean().default(false),
		stream_options: z
			.object({
				include_usage: z.boolean().optional(),
				include_obfuscation: z.boolean().optional(),
			})
			.optional(),
		temperature: z.number().optional(),
		top_p: z.number().optional(),
		max_tokens: z.int().optional(),
		max_completion_tokens: z.int().optional(),
		logprobs: z.boolean().optional(),
		top_logprobs: z.int().min(0).max(20).optional(),
		logit_bias: z.record(z.string(), z.number()).optional(),
		metadata: z.record(z.string(), z.string()).optional(),
		modalities: z.array(z.string()).optional(),
		prediction: loose({}, {}).optional(),
		service_tier: z.string().optional(),
		store: z.boolean().optional(),
		verbosity: z.string().optional(),
		web_search_options: loose({}, {}).optional(),
		tools: z.array(loose({}, {})).optional(),
		tool_choice: z.unknown().optional(),
		response_format: ChatResponseFormat.optional(),
		reasoning_effort: reasoningEffort.optional(),
		reasoning: reasoningConfig.optional(),
		prompt_cache_key: z.string().optional(),
		prompt_cache_options: promptCacheOptionsSchema.optional(),
		prompt_cache_retention: promptCacheRetentionSchema.optional(),
		providerOptions: z.record(z.string(), z.unknown()).optional(),
		plugins: z.array(FileParserPlugin).max(1).optional(),
	},
	{ id: "ChatCompletionRequest" },
);

export const MessagesRequest = loose(
	{
		model: z.string(),
		cache_control: z.record(z.string(), z.unknown()).optional(),
		max_tokens: z.int(),
		messages: z.array(
			loose(
				{
					role: z.enum(["user", "assistant"]),
					content: z.unknown().optional(),
				},
				{},
			),
		),
		system: z
			.unknown()
			.meta({ description: "string or array of text blocks" })
			.optional(),
		stream: z.boolean().default(false),
		temperature: z.number().optional(),
		top_p: z.number().optional(),
		top_k: z.int().optional(),
		stop_sequences: z.array(z.string()).optional(),
		tools: z.array(loose({}, {})).optional(),
		tool_choice: loose({}, {}).optional(),
		thinking: loose({}, {}).optional(),
		output_config: MessagesOutputConfig.optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	},
	{ id: "MessagesRequest" },
);

export const MessagesTokenCountRequest = loose(
	{
		model: z.string(),
		messages: z.array(
			loose(
				{
					role: z.enum(["user", "assistant"]),
					content: z.unknown(),
				},
				{},
			),
		),
		system: z.unknown().optional(),
		tools: z.array(loose({}, {})).optional(),
		tool_choice: loose({}, {}).optional(),
		thinking: loose({}, {}).optional(),
		output_config: MessagesOutputConfig.optional(),
		cache_control: loose({}, {}).optional(),
	},
	{ id: "MessagesTokenCountRequest" },
);

export const MessagesTokenCountResponse = z
	.object({ input_tokens: z.int().nonnegative() })
	.meta({ id: "MessagesTokenCountResponse" });

export const ResponsesRequest = loose(
	{
		model: z.string(),
		input: z
			.unknown()
			.meta({
				description: "string or array of items (message/function_call/...)",
			})
			.optional(),
		instructions: nullableString.optional(),
		stream: z.boolean().default(false),
		max_output_tokens: z.int().optional(),
		max_tool_calls: z.int().min(1).optional(),
		temperature: z.number().optional(),
		top_p: z.number().optional(),
		presence_penalty: z.number().optional(),
		frequency_penalty: z.number().optional(),
		top_logprobs: z.int().min(0).max(20).optional(),
		parallel_tool_calls: z.boolean().optional(),
		include: z.array(z.string()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		service_tier: z.string().optional(),
		stream_options: loose({}, {}).optional(),
		safety_identifier: z.string().max(64).optional(),
		prompt_cache_options: promptCacheOptionsSchema.optional(),
		prompt_cache_retention: promptCacheRetentionSchema.optional(),
		providerOptions: z.record(z.string(), z.unknown()).optional(),
		prompt_cache_key: z.string().max(64).optional(),
		truncation: z.string().optional(),
		context_management: z.array(loose({}, {})).optional(),
		tools: z.array(loose({}, {})).optional(),
		tool_choice: z.unknown().optional(),
		text: ResponsesTextConfig.optional(),
		reasoning: reasoningConfig.optional(),
		store: z.boolean().optional().meta({
			description:
				"Persist server-side state for chaining with previous_response_id. Default follows RESPONSES_STORE_DEFAULT (true = OpenAI-compatible). Managed by the gateway; not forwarded upstream.",
		}),
		previous_response_id: z.string().optional().meta({
			description:
				"Chains with a stored response (store): the gateway concatenates its input+output with the new input. Local pointer, not forwarded upstream. Cannot be combined with conversation.",
		}),
		background: z.boolean().optional().meta({
			description: "Unsupported: background:true is rejected with 400.",
		}),
		conversation: z.unknown().optional().meta({
			description:
				"Unsupported: use previous_response_id for gateway-managed state.",
		}),
		prompt: z.unknown().optional().meta({
			description: "Prompt templates are unsupported (400).",
		}),
		plugins: z.array(FileParserPlugin).max(1).optional(),
	},
	{ id: "ResponsesRequest" },
);

export const ResponsesUsage = z
	.object({
		input_tokens: z.int(),
		input_tokens_details: z.object({
			cached_tokens: z.int(),
			cache_write_tokens: z.int().optional(),
			cache_write_tokens_by_ttl: z.record(z.string(), z.int()).optional(),
		}),
		output_tokens: z.int(),
		output_tokens_details: z.object({ reasoning_tokens: z.int() }),
		total_tokens: z.int(),
	})
	.meta({ id: "ResponsesUsage" });

export const ResponseObject = loose(
	{
		id: z.string(),
		object: z.literal("response"),
		created_at: z.int(),
		completed_at: nullableInteger,
		status: z.string(),
		incomplete_details: z.union([loose({}, {}), z.null()]),
		model: z.string(),
		previous_response_id: nullableString,
		instructions: nullableString,
		output: z.array(loose({}, {})),
		error: z.union([loose({}, {}), z.null()]),
		tools: z.array(loose({}, {})),
		tool_choice: z.unknown(),
		truncation: z.string(),
		parallel_tool_calls: z.boolean(),
		text: loose({}, {}),
		top_p: z.number(),
		presence_penalty: z.number(),
		frequency_penalty: z.number(),
		top_logprobs: z.int(),
		temperature: z.number(),
		reasoning: z.union([loose({}, {}), z.null()]),
		usage: z.union([ResponsesUsage, z.null()]),
		max_output_tokens: nullableInteger,
		max_tool_calls: nullableInteger,
		store: z.boolean(),
		background: z.boolean(),
		service_tier: z.string(),
		metadata: loose({}, {}),
		safety_identifier: nullableString,
		prompt_cache_key: nullableString,
	},
	{ id: "ResponseObject" },
);

export const CompactResponseRequest = z
	.object({
		model: z.string(),
		input: z.unknown().optional(),
		previous_response_id: nullableString.optional(),
		instructions: nullableString.optional(),
		prompt_cache_key: z.string().max(64).optional(),
	})
	.strict()
	.meta({ id: "CompactResponseRequest" });

export const CompactResponseObject = z
	.object({
		id: z.string(),
		object: z.literal("response.compaction"),
		created_at: z.int(),
		output: z.array(loose({}, {})),
		usage: ResponsesUsage,
	})
	.meta({ id: "CompactResponseObject" });

/* ---------------------------------------------------------------- embeddings */

export const EmbeddingsRequest = z
	.object({
		model: z.string().meta({ description: "public model" }),
		input: z.union([
			z.string().min(1),
			z.array(z.string().min(1)).min(1),
			z.array(z.int().min(0)).min(1),
			z.array(z.array(z.int().min(0)).min(1)).min(1),
		]),
		encoding_format: z.enum(["float", "base64"]).default("float").optional(),
		dimensions: z.int().min(1).optional(),
		user: z.string().optional(),
		extra_body: z.record(z.string(), z.unknown()).optional().meta({
			description:
				"Provider-specific JSON parameters without collisions with managed fields.",
		}),
	})
	.meta({ id: "EmbeddingsRequest" });

export const Embedding = z
	.object({
		object: z.literal("embedding"),
		embedding: z.union([
			z.array(z.number()),
			z.string().meta({ description: "Base64 when encoding_format=base64." }),
		]),
		index: z.int(),
	})
	.meta({ id: "Embedding" });

export const EmbeddingsResponse = z
	.object({
		object: z.literal("list"),
		data: z.array(Embedding),
		model: z.string(),
		usage: z
			.object({
				prompt_tokens: z.int().optional(),
				total_tokens: z.int().optional(),
			})
			.optional(),
	})
	.meta({ id: "EmbeddingsResponse" });

/* ------------------------------------------------------------------- rerank */

export const RerankRequest = rerankRequestSchema.meta({
	id: "RerankRequest",
	description:
		"Strict OpenRouter-shaped text reranking request. Image documents are reserved for a future contract version.",
});

export const RerankResult = z
	.object({
		index: z.int().nonnegative(),
		relevance_score: z.number(),
		document: z.object({ text: z.string() }).strict(),
	})
	.strict()
	.meta({ id: "RerankResult" });

export const RerankResponse = z
	.object({
		id: z.string().optional(),
		model: z.string(),
		provider: z.string().optional(),
		results: z.array(RerankResult),
		usage: z
			.object({
				total_tokens: z.int().nonnegative().optional(),
				search_units: z.int().nonnegative().optional(),
				cost: z.number().nonnegative().optional(),
			})
			.strict()
			.optional(),
	})
	.strict()
	.meta({ id: "RerankResponse" });

export const OpenRouterError = z
	.object({
		error: z
			.object({
				code: z.int(),
				message: z.string(),
			})
			.strict(),
	})
	.strict()
	.meta({ id: "OpenRouterError" });

/* -------------------------------------------------------------------- images */

const nullableEnum = (values: [string, ...string[]]) =>
	z.union([z.enum(values), z.null()]);
const sizePattern = z.string().regex(/^(auto|[1-9][0-9]*x[1-9][0-9]*)$/);

export const ImageGenerationRequest = z
	.object({
		model: z.string().meta({ description: "public model" }),
		prompt: z.string().min(1).max(32000),
		background: nullableEnum(["transparent", "opaque", "auto"]).optional(),
		moderation: nullableEnum(["low", "auto"]).optional(),
		n: nullableInteger.optional(),
		output_compression: nullableInteger.optional(),
		output_format: nullableEnum(["png", "jpeg", "webp"]).optional(),
		partial_images: nullableInteger.optional(),
		quality: nullableEnum([
			"standard",
			"hd",
			"low",
			"medium",
			"high",
			"auto",
		]).optional(),
		response_format: nullableEnum(["b64_json"]).default("b64_json").optional(),
		size: z.union([sizePattern, z.null()]).optional(),
		stream: z.union([z.boolean(), z.null()]).default(false).optional(),
		style: nullableEnum(["vivid", "natural"]).optional(),
		user: nullableString.optional(),
		extra_body: z.record(z.string(), z.unknown()).optional().meta({
			description:
				"Provider-specific JSON parameters; max 64 KiB and no collisions with managed fields.",
		}),
	})
	.meta({ id: "ImageGenerationRequest" });

export const ImageEditRequest = z
	.object({
		model: z.string(),
		prompt: z.string().min(1).max(32000),
		image: z
			.array(z.string().meta({ format: "binary" }))
			.min(1)
			.max(16)
			.meta({ description: "Send one or more parts named image or image[]." }),
		mask: z
			.string()
			.meta({
				format: "binary",
				description: "PNG <=4 MB; same dimensions as the first image.",
			})
			.optional(),
		background: nullableEnum(["transparent", "opaque", "auto"]).optional(),
		input_fidelity: nullableEnum(["high", "low"]).optional(),
		n: nullableInteger.optional(),
		output_compression: nullableInteger.optional(),
		output_format: nullableEnum(["png", "jpeg", "webp"]).optional(),
		partial_images: nullableInteger.optional(),
		quality: nullableEnum([
			"standard",
			"low",
			"medium",
			"high",
			"auto",
		]).optional(),
		response_format: nullableEnum(["b64_json"]).default("b64_json").optional(),
		size: z.union([sizePattern, z.null()]).optional(),
		stream: z.union([z.boolean(), z.null()]).default(false).optional(),
		user: nullableString.optional(),
		extra_body: z
			.string()
			.meta({ description: "Serialized JSON object; max 64 KiB." })
			.optional(),
	})
	.meta({ id: "ImageEditRequest" });

export const ImageData = z
	.object({
		b64_json: z.string(),
		revised_prompt: z.string().optional(),
	})
	.meta({ id: "ImageData" });

const imageTokenDetails = z
	.object({
		image_tokens: z.int().optional(),
		text_tokens: z.int().optional(),
	})
	.optional();

export const ImageUsage = z
	.object({
		input_tokens: z.int(),
		output_tokens: z.int(),
		total_tokens: z.int(),
		input_tokens_details: imageTokenDetails,
		output_tokens_details: imageTokenDetails,
	})
	.meta({ id: "ImageUsage" });

export const ImagesResponse = z
	.object({
		created: z.int(),
		data: z.array(ImageData),
		background: z.enum(["transparent", "opaque"]).optional(),
		output_format: z.enum(["png", "jpeg", "webp"]).optional(),
		quality: z.enum(["low", "medium", "high"]).optional(),
		size: z.string().optional(),
		usage: ImageUsage.optional(),
	})
	.meta({ id: "ImagesResponse" });

/* -------------------------------------------------------------------- videos */

export const VideoInputReference = z
	.object({
		image_url: z.union([z.string(), z.object({ url: z.string() })]).optional(),
		file_id: z.string().optional(),
	})
	.meta({
		id: "VideoInputReference",
		description:
			"OpenAI-compatible single reference: exactly one of image_url or file_id.",
	});

const videoUrlPart = (type: string, field: string) =>
	z.object({
		type: z.literal(type),
		[field]: z.object({ url: z.string() }),
	});

export const VideoInputReferencePart = z
	.union([
		videoUrlPart("image_url", "image_url"),
		videoUrlPart("audio_url", "audio_url"),
		videoUrlPart("video_url", "video_url"),
	])
	.meta({
		id: "VideoInputReferencePart",
		description:
			"A reference asset guiding generation. Audio/video references are only honored by providers that support them.",
	});

export const VideoFrameImage = z
	.object({
		type: z.literal("image_url"),
		image_url: z.object({ url: z.string() }),
		frame_type: z.enum(["first_frame", "last_frame"]),
	})
	.meta({ id: "VideoFrameImage" });

export const VideoCreateRequest = loose(
	{
		model: z.string().meta({ description: "public model" }),
		prompt: z.string().min(1).max(32000),
		task: nullableEnum([
			"text_to_video",
			"image_to_video",
			"reference_to_video",
			"edit",
			"extend",
		])
			.optional()
			.meta({
				description:
					"Explicit video workflow. Required by some providers for edit and extend requests.",
			}),
		input_reference: z
			.union([VideoInputReference, z.null()])
			.optional()
			.meta({ description: "Mutually exclusive with input_references." }),
		input_references: z
			.union([z.array(VideoInputReferencePart), z.null()])
			.optional(),
		frame_images: z.union([z.array(VideoFrameImage), z.null()]).optional(),
		seconds: z
			.union([z.string(), z.int(), z.null()])
			.optional()
			.meta({ description: "Mutually exclusive with duration." }),
		duration: z
			.union([z.int().positive(), z.null()])
			.optional()
			.meta({ description: "Duration in seconds." }),
		size: z
			.union([z.string().regex(/^[1-9][0-9]*x[1-9][0-9]*$/), z.null()])
			.optional()
			.meta({
				description: "Interchangeable with aspect_ratio + resolution.",
			}),
		aspect_ratio: nullableEnum([
			"16:9",
			"9:16",
			"1:1",
			"4:3",
			"3:4",
			"3:2",
			"2:3",
			"21:9",
			"9:21",
		]).optional(),
		resolution: nullableEnum([
			"360p",
			"480p",
			"720p",
			"1080p",
			"1K",
			"2K",
			"4K",
		]).optional(),
		seed: z.union([z.int(), z.null()]).optional(),
		generate_audio: z.union([z.boolean(), z.null()]).optional(),
		quality: nullableEnum([
			"auto",
			"low",
			"medium",
			"high",
			"native",
		]).optional(),
		user: nullableString
			.optional()
			.meta({ description: "Gateway-side attribution; never sent upstream." }),
		extra_body: z.record(z.string(), z.unknown()).optional(),
	},
	{ id: "VideoCreateRequest" },
);

export const VideoObject = z
	.object({
		id: z.string(),
		object: z.literal("video"),
		created_at: nullableInteger,
		completed_at: nullableInteger,
		expires_at: nullableInteger,
		model: z.string(),
		status: z.enum(["queued", "in_progress", "completed", "failed"]),
		progress: z.int().min(0).max(100),
		prompt: z.string(),
		error: z
			.union([
				z.object({
					code: nullableString.optional(),
					message: z.string(),
				}),
				z.null(),
			])
			.optional(),
		remixed_from_video_id: nullableString.optional(),
		seconds: z.string().optional(),
		size: z.string().optional(),
		quality: z.enum(["auto", "low", "medium", "high", "native"]).optional(),
	})
	.meta({ id: "VideoObject" });

export const VideoListResponse = z
	.object({
		object: z.literal("list"),
		data: z.array(VideoObject),
		first_id: nullableString,
		last_id: nullableString,
		has_more: z.boolean(),
	})
	.meta({ id: "VideoListResponse" });

export const VideoDeleted = z
	.object({
		id: z.string(),
		object: z.literal("video.deleted"),
		deleted: z.boolean(),
	})
	.meta({ id: "VideoDeleted" });

/* --------------------------------------------------------- deployments/config */

const operationNames = OPERATION_IDS;

export const TransportOverrides = z
	.record(z.enum(operationNames), z.string())
	.meta({
		id: "TransportOverrides",
		description:
			"Advanced operation-to-transport override. Defaults normally come from the adapter.",
	});

export const ExecutionPolicyOverrides = z
	.record(
		z.enum([...CALL_TYPE_VALUES, "all"]),
		z
			.object({
				firstOutputMs: z.int().positive().optional(),
				idleMs: z.int().positive().optional(),
				reasoningOnlyMs: z.int().positive().optional(),
				preCommitMs: z.int().positive().optional(),
				totalMs: z.int().positive().optional(),
			})
			.meta({ id: "ExecutionPolicyOverride" }),
	)
	.meta({
		id: "ExecutionPolicyOverrides",
		description:
			"Per-deployment execution deadlines, keyed by call type ('all' applies to every call type a specific entry does not cover). Values may only TIGHTEN the router's global policy: use it to fail over from a fast upstream long before the budget the slowest deployment in the pool needs.",
	});

export const OperationProfiles = z
	.record(z.enum(operationNames), z.record(z.string(), z.unknown()))
	.meta({ id: "OperationProfiles" });

export const CatalogEntry = loose(
	{
		operations: OperationProfiles,
	},
	{ id: "CatalogEntry" },
);

export const Pricing = pricingSchema.meta({
	id: "Pricing",
	description:
		"Operator pricing in USD cents: token rates are per 1 million tokens and searchUnitCents is per search unit.",
});

export const CreateDeployment = z
	.object({
		publicModel: z
			.string()
			.meta({ description: "Public alias sent as model in /v1." }),
		adapterKey: z.string().meta({
			description:
				"Code adapter key (for example openai, googleaistudio, anthropic, openaicompatible).",
		}),
		upstreamModel: z
			.string()
			.meta({ description: "Exact ID; preserves slash namespaces." }),
		credentials: z.record(z.string(), z.unknown()).meta({
			description:
				"Inline provider credentials. Required keys are exposed by GET /admin/operations under adapter.credentials.required. Encrypted; never returned.",
		}),
		label: nullableString.optional().meta({
			description:
				"Human identifier to tell deployments of the same publicModel apart (e.g. which API key). Snapshotted into operation metadata and attempt records.",
		}),
		failureDomain: nullableString.optional().meta({
			description:
				"Shared provider account or quota domain. Deployments with the same value share upstream throttle state; null keeps the deployment independent.",
		}),
		metadata: z.record(z.string(), z.unknown()).optional().meta({
			description:
				"Free-form operator annotations (team, environment, key alias, rotation date, notes...). Up to 16 KiB; stored and returned verbatim.",
		}),
		catalogEntry: CatalogEntry.optional().meta({
			description:
				"REQUIRED if the model is not in the catalog (custom); FORBIDDEN if it is. 1:1 entry with catalog.json.",
		}),
		pricing: Pricing.optional().meta({
			description: "Operator pricing for cost calculation (optional).",
		}),
		transportOverrides: TransportOverrides.optional().meta({
			description:
				"Per-operation transport override. Usually inferred from the adapter; rarely needed.",
		}),
		executionPolicyOverrides: ExecutionPolicyOverrides.optional(),
		enabled: z.boolean().optional(),
		weight: z.int().min(0).optional(),
		tpmLimit: nullableInteger.optional(),
		rpmLimit: nullableInteger.optional(),
	})
	.meta({ id: "CreateDeployment" });

export const ResolveDeployment = z
	.object({
		publicModel: z
			.string()
			.meta({ description: "Public alias sent as model in /v1." }),
		adapterKey: z.string().meta({
			description:
				"Code adapter key (for example openai, googleaistudio, anthropic, openaicompatible).",
		}),
		upstreamModel: z
			.string()
			.meta({ description: "Exact ID; preserves slash namespaces." }),
		catalogEntry: CatalogEntry.optional().meta({
			description:
				"REQUIRED if the model is not in the catalog (custom); FORBIDDEN if it is. 1:1 entry with catalog.json.",
		}),
		pricing: Pricing.optional().meta({
			description: "Operator pricing for cost calculation (optional).",
		}),
		transportOverrides: TransportOverrides.optional().meta({
			description:
				"Per-operation transport override. Usually inferred from the adapter; rarely needed.",
		}),
		executionPolicyOverrides: ExecutionPolicyOverrides.optional(),
		credentials: z.record(z.string(), z.unknown()).optional().meta({
			description:
				"Accepted for body reuse with POST /admin/deployments, but ignored by resolve.",
		}),
		label: nullableString.optional().meta({
			description:
				"Accepted for body reuse with POST /admin/deployments, but ignored by resolve.",
		}),
		failureDomain: nullableString.optional().meta({
			description:
				"Accepted for body reuse with POST /admin/deployments, but ignored by resolve.",
		}),
		metadata: z.record(z.string(), z.unknown()).optional().meta({
			description:
				"Accepted for body reuse with POST /admin/deployments, but ignored by resolve.",
		}),
	})
	.meta({ id: "ResolveDeployment" });

export const UpdateDeployment = z
	.object({
		publicModel: z.string().optional(),
		upstreamModel: z.string().optional(),
		credentials: z.record(z.string(), z.unknown()).optional().meta({
			description: "Credential patch; re-encrypted, never returned.",
		}),
		label: nullableString.optional().meta({
			description: "Human identifier; null clears it.",
		}),
		failureDomain: nullableString.optional().meta({
			description: "Shared quota domain; null clears it.",
		}),
		metadata: z.record(z.string(), z.unknown()).optional().meta({
			description: "Replaces the stored metadata object.",
		}),
		catalogEntry: z.union([CatalogEntry, z.null()]).optional(),
		pricing: z.union([Pricing, z.null()]).optional(),
		transportOverrides: TransportOverrides.optional(),
		executionPolicyOverrides: ExecutionPolicyOverrides.optional(),
		enabled: z.boolean().optional(),
		weight: z.int().min(0).optional(),
		tpmLimit: nullableInteger.optional(),
		rpmLimit: nullableInteger.optional(),
	})
	.meta({ id: "UpdateDeployment" });

/* ---------------------------------------------------------------- virtual keys */

const budgetReset = z.union([
	z.enum(["hourly", "daily", "weekly", "monthly"]),
	z.null(),
]);

export const CreateKey = z
	.object({
		name: z.string(),
		allowedModels: z
			.array(z.string())
			.optional()
			.meta({ description: "Allowed Public Models; [] = all" }),
		maxBudgetCents: nullableInteger.optional(),
		budgetReset: budgetReset.optional(),
		tpm: nullableInteger.optional(),
		rpm: nullableInteger.optional(),
		expiresAt: z.union([z.iso.datetime(), z.null()]).optional(),
	})
	.meta({ id: "CreateKey" });

export const UpdateKey = z
	.object({
		name: z.string().optional(),
		allowedModels: z.array(z.string()).optional(),
		maxBudgetCents: nullableInteger.optional(),
		budgetReset: budgetReset.optional(),
		tpm: nullableInteger.optional(),
		rpm: nullableInteger.optional(),
		enabled: z.boolean().optional(),
		expiresAt: z.union([z.iso.datetime(), z.null()]).optional(),
		resetSpend: z
			.boolean()
			.optional()
			.meta({ description: "true resets spend for the current period" }),
	})
	.meta({ id: "UpdateKey" });

/* ------------------------------------------------------------ router/fallbacks */

const ExecutionPolicy = z.object({
	firstOutputMs: z.int().positive().max(EXECUTION_POLICY_MAX_TOTAL_MS),
	idleMs: z.union([
		z.int().positive().max(EXECUTION_POLICY_MAX_TOTAL_MS),
		z.null(),
	]),
	reasoningOnlyMs: z.union([
		z.int().positive().max(EXECUTION_POLICY_MAX_TOTAL_MS),
		z.null(),
	]),
	preCommitMs: z.int().positive().max(EXECUTION_POLICY_MAX_TOTAL_MS),
	totalMs: z.int().positive().max(EXECUTION_POLICY_MAX_TOTAL_MS),
	maxAttempts: z.int().min(1).max(20),
});

const OperationExecutionPolicy = z.object({
	json: ExecutionPolicy,
	stream: ExecutionPolicy,
});

export const RouterSettings = z
	.object({
		executionPolicies: z
			.object({
				chat: OperationExecutionPolicy,
				"images.generations": OperationExecutionPolicy,
				"images.edits": OperationExecutionPolicy,
				"videos.generations": OperationExecutionPolicy,
				"audio.transcriptions": OperationExecutionPolicy,
				embeddings: OperationExecutionPolicy,
				rerank: OperationExecutionPolicy,
			})
			.optional(),
		routingStrategy: z
			.enum([
				"simple-shuffle",
				"least-busy",
				"usage-based-tpm",
				"usage-based-rpm",
				"latency-based",
				"throughput-based",
				"price-based",
				"health-aware",
			])
			.optional(),
		unsupportedParameterStrategy: z
			.enum(["drop", "error", "allow"])
			.optional()
			.meta({
				description:
					"How the router handles parameters explicitly marked unsupported by the selected deployment profile.",
			}),
		allowedFails: z.int().min(0).optional().meta({
			description:
				"Absolute ceiling of transient failures in the fixed window. It opens the circuit regardless of how much traffic succeeded, so it exists for a deployment failing outright before the window has collected minWindowRequests attempts.",
		}),
		allowedFailsByClass: z
			.partialRecord(
				z.enum([
					"bad_request",
					"auth",
					"permission",
					"not_found",
					"rate_limit",
					"context_window",
					"content_policy",
					"timeout",
					"server",
				]),
				z.int().min(0),
			)
			.optional()
			.meta({
				description:
					"Per-error-class override of allowedFails. A timeout and a 502 are both transient and rarely deserve the same tolerance.",
			}),
		failureRatePercent: z.number().gt(0).max(1).optional().meta({
			description:
				"Share of a window's attempts that must fail before the circuit opens (0.5 = half). This is the primary signal; an absolute count punishes a busy deployment for the same error rate a quiet one survives.",
		}),
		minWindowRequests: z.int().min(1).optional().meta({
			description:
				"Attempts required in the window before the rate rule may fire. Without a floor, the first failures after a quiet period read as a 100% failure rate.",
		}),
		protectLastDeployment: z.boolean().optional().meta({
			description:
				"Never open the deployment circuit when a public model has nowhere else to route. Quarantining the only deployment turns a degraded upstream into a total outage, and the gateway's 503 is less useful to the caller than the upstream's own error.",
		}),
		adaptiveTimeoutsEnabled: z.boolean().optional().meta({
			description:
				"Narrow each attempt's first-output deadline to a multiple of what that deployment usually takes, instead of the budget the slowest member of the pool needs.",
		}),
		adaptiveTimeoutMultiplier: z.number().min(1).optional().meta({
			description:
				"How many times its own typical time-to-first-output a deployment is granted.",
		}),
		adaptiveTimeoutFloorMs: z.int().positive().optional().meta({
			description:
				"Lower bound for the adaptive deadline, so a very fast deployment is not cut off by ordinary variance.",
		}),
		cooldownSeconds: z.int().min(0).optional().meta({
			description:
				"Time a deployment remains unavailable after exceeding allowedFails. Zero disables automatic cooldown circuits.",
		}),
		failureWindowSeconds: z.int().min(1).optional(),
		maxCooldownSeconds: z.int().min(1).optional(),
		halfOpenProbeSeconds: z.int().min(1).optional(),
		configurationCooldownSeconds: z.int().min(1).optional(),
		throttleCooldownSeconds: z.int().min(1).optional(),
		retryAfterSeconds: z.int().min(0).optional().meta({
			description:
				"Minimum wait before a transient retry. Exponential full jitter is added above this floor.",
		}),
	})
	.meta({ id: "RouterSettings" });

export const Fallback = z
	.object({
		primaryModel: z.string().meta({
			description:
				"Primary public name; must have at least one persisted deployment.",
		}),
		fallbackModels: z.array(z.string()).min(1).max(5).meta({
			uniqueItems: true,
			description:
				"Fallback public names in order. Each one must exist and share an executable operation with the primary.",
		}),
		reason: z
			.enum(["general", "context_window", "content_policy"])
			.default("general")
			.optional()
			.meta({
				description:
					"Aggregated cause of the primary failure; not an operation. Chain lookup is exact by reason.",
			}),
	})
	.meta({ id: "Fallback" });

export const Login = z
	.object({
		username: z.string().min(1).meta({
			description:
				"DASH_ROOT_USER, or the username of a row in dashboard_users. Compared case-insensitively.",
		}),
		password: z.string().min(1),
	})
	.meta({ id: "Login" });

export const ChangePassword = z
	.object({
		currentPassword: z.string().min(1),
		newPassword: z.string().min(12),
	})
	.meta({ id: "ChangePassword" });

export const CreateDashboardUser = z
	.object({
		username: z.string().regex(/^[a-zA-Z0-9._-]{3,64}$/),
		password: z.string().min(12),
		role: z.enum(["owner", "admin", "viewer"]).meta({
			description:
				"viewer reads topology and aggregates only; admin adds writes, logs, payload samples and inference; owner adds extensions and user management.",
		}),
		mustChangePassword: z.boolean().optional(),
	})
	.meta({ id: "CreateDashboardUser" });

export const UpdateDashboardUser = z
	.object({
		role: z.enum(["owner", "admin", "viewer"]).optional(),
		enabled: z.boolean().optional(),
		mustChangePassword: z.boolean().optional(),
	})
	.meta({ id: "UpdateDashboardUser" });

export const SetDashboardPassword = z
	.object({
		password: z.string().min(12),
		mustChangePassword: z.boolean().optional().meta({
			description:
				"Defaults to true: an admin-set password is a temporary one.",
		}),
	})
	.meta({ id: "SetDashboardPassword" });

/* ------------------------------------------------------- admin responses */

/**
 * Response shapes for the management API. Request bodies were already specified; without these, a
 * generated client (openapi-typescript, or any other) types every admin response as `unknown`.
 *
 * Two levels of precision, on purpose:
 *  - Small, stable rows (deployment, key, user, session, fallback) are described exactly.
 *  - Wide observability projections are described `loose`: the fields a client actually reads are
 *    typed, while the rest of the row stays open, so adding a column to `gateway_operations` does not
 *    silently break the contract.
 */

const timestamp = z.iso.datetime();
const nullableTimestamp = z.union([z.iso.datetime(), z.null()]);

export const Deployment = z
	.object({
		id: z.uuid(),
		publicModel: z.string(),
		adapterKey: z.string(),
		upstreamModel: z.string(),
		label: nullableString,
		failureDomain: nullableString,
		metadata: z.record(z.string(), z.unknown()),
		/** True when the deployment carries its own inline catalog entry. */
		custom: z.boolean(),
		catalogEntry: z.union([CatalogEntry, z.null()]),
		pricing: z.union([Pricing, z.null()]),
		transportOverrides: TransportOverrides,
		executionPolicyOverrides: ExecutionPolicyOverrides,
		enabled: z.boolean(),
		weight: z.int(),
		tpmLimit: nullableInteger,
		rpmLimit: nullableInteger,
		createdAt: timestamp,
		updatedAt: timestamp,
	})
	.meta({
		id: "Deployment",
		description:
			"A deployment as returned by the admin API. Credentials are never included, encrypted or otherwise.",
	});

export const VirtualKey = z
	.object({
		id: z.uuid(),
		name: z.string(),
		/** Display/search prefix. The key itself is returned only once, at creation. */
		keyPrefix: z.string(),
		createdBy: nullableString,
		allowedModels: z.array(z.string()),
		maxBudgetCents: nullableInteger,
		budgetReset: z.union([
			z.enum(["hourly", "daily", "weekly", "monthly"]),
			z.null(),
		]),
		budgetResetAt: nullableTimestamp,
		spendCents: z.string(),
		tpm: nullableInteger,
		rpm: nullableInteger,
		enabled: z.boolean(),
		expiresAt: nullableTimestamp,
		createdAt: timestamp,
		updatedAt: timestamp,
	})
	.meta({ id: "VirtualKey" });

export const CreatedVirtualKey = VirtualKey.extend({
	key: z.string().meta({
		description:
			"The plaintext key. Returned ONLY here, at creation; it is stored hashed and cannot be retrieved again.",
	}),
}).meta({ id: "CreatedVirtualKey" });

export const DashboardUser = z
	.object({
		id: z.uuid(),
		username: z.string(),
		role: z.enum(["owner", "admin", "viewer"]),
		enabled: z.boolean(),
		mustChangePassword: z.boolean(),
		lastLoginAt: nullableTimestamp,
		createdBy: nullableString,
		createdAt: timestamp,
		updatedAt: timestamp,
	})
	.meta({
		id: "DashboardUser",
		description:
			"An operator row. The password digest is never returned. The root operator is not a row and never appears here.",
	});

export const DashboardSession = z
	.object({
		id: z.uuid(),
		userId: z.union([z.uuid(), z.null()]),
		role: z.enum(["owner", "admin", "viewer"]),
		expiresAt: timestamp,
		lastSeenAt: timestamp,
		revokedAt: nullableTimestamp,
		ip: nullableString,
		userAgent: nullableString,
		createdAt: timestamp,
	})
	.meta({
		id: "DashboardSession",
		description:
			"A live operator session. The stored token hash is never returned.",
	});

export const Permission = z
	.enum([
		"deployments:read",
		"deployments:write",
		"keys:read",
		"keys:write",
		"usage:read",
		"logs:read",
		"payloads:read",
		"inference:use",
		"settings:read",
		"settings:write",
		"extensions:manage",
		"users:manage",
		"audit:read",
	])
	.meta({ id: "Permission" });

export const OperatorIdentity = z
	.object({
		user: z.object({
			/** Null for the root operator, which lives in the environment rather than the database. */
			id: z.union([z.uuid(), z.null()]),
			username: nullableString,
			role: z.enum(["owner", "admin", "viewer"]),
			isRoot: z.boolean(),
			mustChangePassword: z.boolean(),
		}),
		permissions: z.array(Permission),
		expiresAt: z.iso.datetime().optional(),
	})
	.meta({ id: "OperatorIdentity" });

export const DashboardConfig = z
	.object({
		enabled: z.boolean(),
		authMethods: z.array(z.enum(["password"])),
	})
	.meta({
		id: "DashboardConfig",
		description:
			"Whether human authentication exists on this deployment. Unauthenticated and content-free.",
	});

export const FallbackPolicy = z
	.object({
		id: z.uuid(),
		primaryModel: z.string(),
		fallbackModels: z.array(z.string()),
		reason: z.enum(["general", "context_window", "content_policy"]),
		createdAt: timestamp,
	})
	.meta({ id: "FallbackPolicy" });

export const DashboardSettings = z
	.object({
		sessionTtlMinutes: z.int().min(5).max(43_200).optional(),
		sessionIdleMinutes: z.int().min(1).max(43_200).optional(),
		loginMaxAttempts: z.int().min(1).max(100).optional(),
		loginLockoutMinutes: z.int().min(1).max(1_440).optional(),
	})
	.meta({
		id: "DashboardSettings",
		description:
			"Operator-session policy. Every field is optional; only those supplied change.",
	});

export const DashboardSettingsState = z
	.object({
		sessionTtlMinutes: z.int(),
		sessionIdleMinutes: z.int(),
		loginMaxAttempts: z.int(),
		loginLockoutMinutes: z.int(),
		updatedAt: z.iso.datetime(),
	})
	.meta({ id: "DashboardSettingsState" });

export const RouterSettingsState = z
	.object({
		routingStrategy: z.string(),
		unsupportedParameterStrategy: z.enum(["drop", "error", "allow"]),
		allowedFails: z.int(),
		allowedFailsByClass: z.partialRecord(
			z.enum([
				"bad_request",
				"auth",
				"permission",
				"not_found",
				"rate_limit",
				"context_window",
				"content_policy",
				"timeout",
				"server",
			]),
			z.int(),
		),
		failureRatePercent: z.number(),
		minWindowRequests: z.int(),
		protectLastDeployment: z.boolean(),
		adaptiveTimeoutsEnabled: z.boolean(),
		adaptiveTimeoutMultiplier: z.number(),
		adaptiveTimeoutFloorMs: z.int(),
		cooldownSeconds: z.int(),
		failureWindowSeconds: z.int(),
		maxCooldownSeconds: z.int(),
		halfOpenProbeSeconds: z.int(),
		configurationCooldownSeconds: z.int(),
		throttleCooldownSeconds: z.int(),
		retryAfterSeconds: z.int(),
		executionPolicies: z.record(z.string(), z.unknown()),
		updatedAt: timestamp,
	})
	.meta({
		id: "RouterSettingsState",
		description:
			"The effective router configuration. GET returns null when it has never been written.",
	});

export const UsageRow = z
	.object({
		...cacheUsage,
		usageReported: z.number().optional(),
		/** The grouping value, or null for groupBy=none. */
		key: nullableString,
		requests: z.int(),
		promptTokens: z.int(),
		completionTokens: z.int(),
		reasoningTokens: z.int(),
		totalTokens: z.int(),
		searchUnits: z.int(),
		consumerCostCents: z.number(),
		upstreamCostCents: z.number(),
	})
	.meta({ id: "UsageRow" });

export const AuditEntry = z
	.object({
		id: z.uuid(),
		at: timestamp,
		/** `admin` for a mutating /admin call; `payload_access` for a read of a retained sample. */
		kind: z.enum(["admin", "payload_access"]),
		actor: z.string(),
		action: z.string(),
		targetType: nullableString,
		targetId: nullableString,
		requestId: nullableString,
		status: nullableInteger,
		ip: nullableString,
		metadata: z.record(z.string(), z.unknown()),
	})
	.meta({
		id: "AuditEntry",
		description:
			"One entry of the operator audit trail: a mutating /admin call, or a read of a retained request/response sample.",
	});

export const OperationSummaryRow = loose(
	{
		id: z.uuid(),
		requestId: z.string(),
		virtualKeyId: z.union([z.uuid(), z.null()]),
		/** "master-key", "root", "user:<uuid>" or "key:<uuid>". */
		actor: nullableString,
		publicModel: nullableString,
		callType: z.string(),
		lifecycleState: z.string(),
		outcome: nullableString,
		degraded: z.boolean(),
		terminalVerified: z.boolean(),
		stream: z.boolean(),
		cacheHit: z.boolean(),
		httpStatus: nullableInteger,
		totalTokens: nullableInteger,
		durationMs: nullableInteger,
		startedAt: timestamp,
	},
	{
		id: "OperationSummaryRow",
		description:
			"One row of GET /admin/logs. Additional columns of gateway_operations are returned and intentionally left unconstrained.",
	},
);

export const RetainedPayloadState = z
	.object({
		/** False once retention has swept the sample, or for operations older than capture. */
		retained: z.boolean(),
		/** Whether GET /admin/logs/{id}/payload would return it: retained and access open. */
		readable: z.boolean(),
		/** Gateway-wide OBSERVABILITY_PAYLOAD_ACCESS. `sealed` refuses every credential. */
		access: z.enum(["open", "sealed"]),
		/** Why the sample was kept: the operation outcome, or "degraded". */
		captureReason: nullableString,
		expiresAt: z.union([timestamp, z.null()]),
	})
	.meta({
		id: "RetainedPayloadState",
		description:
			"Whether a retained request/response sample stands behind this operation, and whether it can be read. Describing it costs no audit entry; reading it does.",
	});

export const OperationDetail = loose(
	{
		id: z.uuid(),
		requestId: z.string(),
		attempts: z.array(z.record(z.string(), z.unknown())).meta({
			description: "Ordered upstream attempts for this operation.",
		}),
		payload: RetainedPayloadState,
	},
	{
		id: "OperationDetail",
		description:
			"A full operation record, its ordered upstream-attempt timeline, and the state of its retained payload sample.",
	},
);

export const ObservabilitySummary = loose(
	{
		totals: z.record(z.string(), z.unknown()),
		groups: z.record(z.string(), z.unknown()),
		persistence: z.record(z.string(), z.unknown()),
		alerts: z.record(z.string(), z.boolean()),
	},
	{ id: "ObservabilitySummary" },
);

export const ExtensionRuntimeStatus = loose(
	{
		loaded: z.boolean(),
		status: z.enum(["ok", "degraded", "error"]),
		healthy: z.boolean(),
		definitions: z.array(
			loose(
				{ key: z.string(), version: nullableString },
				{ id: "ExtensionDefinitionState" },
			),
		),
		instances: z.array(
			loose(
				{
					id: z.string(),
					definition: z.string(),
					enabled: z.boolean(),
					status: z.string(),
					critical: z.union([z.boolean(), z.null()]),
					priority: z.int(),
					failureCount: z.int(),
					disabledReason: nullableString,
					lastError: nullableString,
					hooks: z.array(z.string()),
				},
				{ id: "ExtensionInstanceState" },
			),
		),
	},
	{
		id: "ExtensionRuntimeStatus",
		description:
			"Live extension runtime state of the process that answered. An instance disabled by its breaker is disabled in THAT replica; the stored row is unchanged and other replicas may still be running it.",
	},
);

export const ExtensionArtifact = loose(
	{
		key: z.string(),
		version: z.int(),
		status: z.string(),
		contentHash: z.string(),
		sizeBytes: z.int(),
		uploadedBy: nullableString,
	},
	{ id: "ExtensionArtifact" },
);

export const ExtensionInstance = loose(
	{
		id: z.string(),
		definitionKey: z.string(),
		enabled: z.boolean(),
		priority: z.int(),
	},
	{ id: "ExtensionInstance" },
);

export const AdapterOperations = loose(
	{
		adapters: z.array(z.record(z.string(), z.unknown())),
	},
	{
		id: "AdapterOperations",
		description:
			"Available operations, required credentials and transports, per registered adapter.",
	},
);

export const ResolvedDeployment = loose(
	{},
	{
		id: "ResolvedDeployment",
		description:
			"Dry-run resolution of a deployment body: effective capabilities, operations and transports, without saving.",
	},
);

export const CacheInvalidation = z
	.object({ deleted: z.int() })
	.meta({ id: "CacheInvalidation" });

export const PasswordChanged = z
	.object({ expiresAt: z.iso.datetime() })
	.meta({ id: "PasswordChanged" });
