import { OPERATION_IDS } from "#operations/registry.ts";
import { EFFORT_ORDER } from "#core/reasoning.ts";
import * as z from "zod/v4";

export const pricingSchema = z
	.object({
		inputCentsPerMTokens: z.number().nonnegative().optional(),
		outputCentsPerMTokens: z.number().nonnegative().optional(),
		cacheReadCentsPerMTokens: z.number().nonnegative().optional(),
		cacheWriteCentsPerMTokens: z.number().nonnegative().optional(),
		searchUnitCents: z.number().nonnegative().optional(),
		tiers: z
			.array(
				z
					.object({
						aboveInputTokens: z.number().int().positive(),
						inputCentsPerMTokens: z.number().nonnegative().optional(),
						outputCentsPerMTokens: z.number().nonnegative().optional(),
						cacheReadCentsPerMTokens: z.number().nonnegative().optional(),
						cacheWriteCentsPerMTokens: z.number().nonnegative().optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict();

const capabilitiesSchema = z
	.object({
		tools: z.boolean().optional(),
		vision: z.boolean().optional(),
		reasoning: z.boolean().optional(),
		structuredOutputs: z.boolean().optional(),
	})
	.strict();

const requiredCapabilitiesSchema = z
	.object({
		tools: z.boolean(),
		vision: z.boolean(),
		reasoning: z.boolean(),
		structuredOutputs: z.boolean(),
	})
	.strict();

const modalitySchema = z.enum([
	"text",
	"image",
	"audio",
	"video",
	"pdf",
	"file",
	"embedding",
	"moderation",
]);

const modalitiesSchema = z
	.object({
		input: z.array(modalitySchema).optional(),
		output: z.array(modalitySchema).optional(),
	})
	.strict();

const parameterSupportSchema = z
	.object({
		mode: z
			.enum(["supported", "unsupported", "ignored", "range", "mapped"])
			.optional(),
		min: z.number().optional(),
		max: z.number().optional(),
		values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
		upstreamField: z.string().optional(),
		notes: z.string().optional(),
	})
	.passthrough();

const chatTemplateFlagSchema = z
	.object({
		param: z.string().min(1),
		onValue: z.union([z.boolean(), z.string(), z.number()]).optional(),
		offValue: z.union([z.boolean(), z.string(), z.number()]).optional(),
	})
	.strict();

const bodyFieldReasoningSchema = z
	.object({
		param: z.string().min(1),
		onValue: z.unknown().optional(),
		offValue: z.unknown().optional(),
	})
	.strict();

const reasoningSchema = z
	.object({
		kind: z.enum([
			"openai_effort",
			"openai_body",
			"anthropic_adaptive",
			"anthropic_budget",
			"gemini_level",
			"gemini_budget",
			"chat_template_flag",
			"fixed",
		]),
		// Levels the model accepts, as points on the canonical ladder. Including "none" means the model
		// has a literal off switch; omitting it means it always reasons (a "none" request snaps to the floor).
		levels: z.array(z.enum(EFFORT_ORDER)).min(1),
		budgets: z
			.partialRecord(z.enum(EFFORT_ORDER), z.number().int().nonnegative())
			.optional(),
		// Translates our canonical effort to the upstream's native label (e.g. a binary toggle
		// `none | high` the upstream expects as `{ high: "auto" }`). Keys = canonical efforts.
		upstreamEffortMap: z
			.partialRecord(z.enum(EFFORT_ORDER), z.string().min(1))
			.optional(),
		// Only for kind "openai_body": top-level body field and optional scalar effort.
		bodyField: bodyFieldReasoningSchema.optional(),
		effortField: z.string().min(1).optional(),
		// Only for kind "chat_template_flag": flag inside chat_template_kwargs (vLLM/kimi/Qwen).
		chatTemplateFlag: chatTemplateFlagSchema.optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		const levels = new Set(value.levels);
		if (
			(value.kind === "anthropic_budget" || value.kind === "gemini_budget") &&
			levels.has("max") &&
			value.budgets?.max === undefined
		) {
			ctx.addIssue({
				code: "custom",
				path: ["budgets", "max"],
				message: 'required when a budget-based reasoning spec declares "max"',
			});
		}
		for (const key of Object.keys(value.upstreamEffortMap ?? {})) {
			if (!levels.has(key as (typeof EFFORT_ORDER)[number])) {
				ctx.addIssue({
					code: "custom",
					path: ["upstreamEffortMap", key],
					message: `"${key}" is not one of the declared levels`,
				});
			}
		}
		if (
			value.kind === "chat_template_flag" &&
			value.chatTemplateFlag === undefined
		) {
			ctx.addIssue({
				code: "custom",
				path: ["chatTemplateFlag"],
				message: 'required when kind is "chat_template_flag"',
			});
		}
		if (
			value.kind !== "chat_template_flag" &&
			value.chatTemplateFlag !== undefined
		) {
			ctx.addIssue({
				code: "custom",
				path: ["chatTemplateFlag"],
				message: 'only allowed when kind is "chat_template_flag"',
			});
		}
		if (value.kind === "fixed" && levels.has("none")) {
			ctx.addIssue({
				code: "custom",
				path: ["levels"],
				message: 'a "fixed" reasoner always reasons and cannot include "none"',
			});
		}
		if (value.kind === "openai_body" && value.bodyField === undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["bodyField"],
				message: 'required when kind is "openai_body"',
			});
		}
		if (value.kind !== "openai_body" && value.bodyField !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["bodyField"],
				message: 'only allowed when kind is "openai_body"',
			});
		}
		if (value.kind !== "openai_body" && value.effortField !== undefined) {
			ctx.addIssue({
				code: "custom",
				path: ["effortField"],
				message: 'only allowed when kind is "openai_body"',
			});
		}
	});

const imageOperationProfileSchema = z
	.object({
		// ── Client contract (what it can request; the gateway validates against this) ──
		maxPromptChars: z.int().positive().optional(),
		maxInputImages: z.int().nonnegative().optional(),
		maxImageBytes: z.int().positive().optional(),
		maxTotalInputBytes: z.int().positive().optional(),
		maxN: z.int().positive().optional(),
		supportsMask: z.boolean().optional(),
		supportsInputFidelity: z.boolean().optional(),
		supportsModeration: z.boolean().optional(),
		supportsStyle: z.boolean().optional(),
		supportsTransparentBackground: z.boolean().optional(),
		outputFormats: z.array(z.enum(["png", "jpeg", "webp"])).optional(),
		qualities: z
			.array(z.enum(["standard", "hd", "low", "medium", "high", "auto"]))
			.optional(),
		responseFormats: z.array(z.literal("b64_json")).optional(),
		sizes: z
			.record(
				z.string(),
				z
					.object({
						aspectRatio: z.string().optional(),
						imageSize: z.string().optional(),
					})
					.strict(),
			)
			.optional(),
		autoSize: z
			.object({
				aspectRatio: z.string().optional(),
				imageSize: z.string().optional(),
			})
			.strict()
			.optional(),
		arbitrarySize: z
			.object({
				divisibleBy: z.int().positive(),
				minAspectRatio: z.number().positive(),
				maxAspectRatio: z.number().positive(),
				maxWidth: z.int().positive(),
				maxHeight: z.int().positive(),
				maxPixels: z.int().positive().optional(),
			})
			.strict()
			.optional(),
		// Gateway behavior (internal; safe defaults if omitted).
		supportsNativeStreaming: z.boolean().optional(),
		nativeOutputFormat: z.boolean().optional(),
		nativeOutputCompression: z.boolean().optional(),
		qualityMappings: z
			.partialRecord(
				z.enum(["standard", "hd", "low", "medium", "high", "auto"]),
				z
					.object({
						thinkingLevel: z.enum(["minimal", "low", "high"]).optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict();

const textGenerateProfileSchema = z
	.object({
		capabilities: capabilitiesSchema.optional(),
		maxInputTokens: z.int().positive().optional(),
		maxOutputTokens: z.int().positive().optional(),
		modalities: modalitiesSchema.optional(),
		contracts: z
			.array(
				z.enum([
					"chat.completions",
					"responses",
					"messages",
					"images.generations",
					"images.edits",
					"audio.transcriptions",
					"videos",
				]),
			)
			.optional(),
		parameters: z
			.record(z.string(), z.union([z.boolean(), parameterSupportSchema]))
			.optional(),
		reasoning: reasoningSchema.optional(),
	})
	.strict();

const transcriptionOperationProfileSchema = z
	.object({
		responseFormats: z
			.array(z.enum(["json", "text", "srt", "verbose_json", "vtt"]))
			.min(1),
		supportsStreaming: z.boolean().optional(),
		supportsTimestampGranularities: z.boolean().optional(),
		maxFileBytes: z.int().positive().optional(),
	})
	.strict();

const videoOperationProfileSchema = z
	.object({
		maxPromptChars: z.int().positive().optional(),
		durations: z.array(z.string().min(1)).min(1).optional(),
		qualities: z
			.array(z.enum(["standard", "hd", "low", "medium", "high", "auto"]))
			.min(1)
			.optional(),
		sizes: z
			.record(
				z.string(),
				z
					.object({
						size: z.string().optional(),
						aspectRatio: z.string().optional(),
						resolution: z.string().optional(),
					})
					.strict(),
			)
			.optional(),
		supportsImageUrl: z.boolean().optional(),
		supportsAudioUrl: z.boolean().optional(),
		supportsVideoUrl: z.boolean().optional(),
		supportsFileId: z.boolean().optional(),
		supportsFrameImages: z.boolean().optional(),
		supportsSeed: z.boolean().optional(),
		supportsGenerateAudio: z.boolean().optional(),
		maxInputReferences: z.int().positive().optional(),
		requiresDataUrlImageReference: z.boolean().optional(),
		maxReferenceBytes: z.int().positive().optional(),
		contentVariants: z
			.array(z.enum(["video", "thumbnail", "spritesheet"]))
			.min(1)
			.optional(),
		pollIntervalSeconds: z.int().positive().optional(),
	})
	.strict();

const embeddingOperationProfileSchema = z
	.object({
		dimensions: z.int().positive().optional(),
		supportsDimensions: z.boolean().optional(),
		minDimensions: z.int().positive().optional(),
		maxDimensions: z.int().positive().optional(),
		encodingFormats: z
			.array(z.enum(["float", "base64"]))
			.min(1)
			.optional(),
		maxInputs: z.int().positive().optional(),
		maxInputTokens: z.int().positive().optional(),
		maxTotalTokens: z.int().positive().optional(),
		maxInputBytes: z.int().positive().optional(),
		maxTotalInputBytes: z.int().positive().optional(),
		supportsTokenInput: z.boolean().optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		const maxDimensions = value.maxDimensions ?? value.dimensions;
		if (
			value.minDimensions !== undefined &&
			maxDimensions !== undefined &&
			value.minDimensions > maxDimensions
		) {
			ctx.addIssue({
				code: "custom",
				path: ["minDimensions"],
				message: "must be <= maxDimensions",
			});
		}
		if (value.supportsDimensions === false) {
			for (const key of ["minDimensions", "maxDimensions"] as const) {
				if (value[key] !== undefined) {
					ctx.addIssue({
						code: "custom",
						path: [key],
						message: "only allowed when supportsDimensions is true",
					});
				}
			}
		}
	});

const rerankOperationProfileSchema = z
	.object({
		documentModalities: z.array(z.enum(["text", "image"])).min(1),
		imageSources: z
			.array(z.enum(["url", "data_url"]))
			.min(1)
			.optional(),
		maxDocuments: z.int().positive().optional(),
		maxQueryBytes: z.int().positive().optional(),
		maxDocumentBytes: z.int().positive().optional(),
		maxTotalDocumentBytes: z.int().positive().optional(),
		maxTokensPerDocument: z.int().positive().optional(),
		maxTotalTokens: z.int().positive().optional(),
		documentsPerSearchUnit: z.int().positive().optional(),
	})
	.strict()
	.superRefine((value, ctx) => {
		if (!value.documentModalities.includes("image") && value.imageSources) {
			ctx.addIssue({
				code: "custom",
				path: ["imageSources"],
				message: 'only allowed when documentModalities includes "image"',
			});
		}
		if (
			value.maxDocumentBytes !== undefined &&
			value.maxTotalDocumentBytes !== undefined &&
			value.maxDocumentBytes > value.maxTotalDocumentBytes
		) {
			ctx.addIssue({
				code: "custom",
				path: ["maxDocumentBytes"],
				message: "must be <= maxTotalDocumentBytes",
			});
		}
	});

export const operationProfilesSchema = z
	.object({
		"text.generate": textGenerateProfileSchema.optional(),
		"image.generate": imageOperationProfileSchema.optional(),
		"image.edit": imageOperationProfileSchema.optional(),
		"video.generate": videoOperationProfileSchema.optional(),
		"audio.transcribe": transcriptionOperationProfileSchema.optional(),
		"embedding.create": embeddingOperationProfileSchema.optional(),
		rerank: rerankOperationProfileSchema.optional(),
	})
	.strict()
	.refine(
		(value) =>
			OPERATION_IDS.some((operation) => value[operation] !== undefined),
		{ message: "At least one operation profile is required" },
	);

// Mirrors CatalogEntry (src/catalog/types.ts): only data the gateway consumes plus human-facing flags.
const catalogEntrySchema = z
	.object({
		deprecated: z.boolean().optional(),
		operations: operationProfilesSchema,
		pricing: pricingSchema.optional(),
		notes: z.string().min(1).optional(),
	})
	.strict();

function validateImageOperationRequirements(
	value: z.infer<typeof operationProfilesSchema>,
	ctx: z.RefinementCtx,
	pathPrefix: Array<string | number> = [],
): void {
	for (const op of ["image.generate", "image.edit"] as const) {
		const entry = value[op];
		if (!entry) continue;
		if (!entry.outputFormats || entry.outputFormats.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: [...pathPrefix, op, "outputFormats"],
				message: "required for image operations",
			});
		}
		if (!entry.responseFormats || entry.responseFormats.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: [...pathPrefix, op, "responseFormats"],
				message: "required for image operations",
			});
		}
		if (!entry.sizes && !entry.arbitrarySize && !entry.autoSize) {
			ctx.addIssue({
				code: "custom",
				path: [...pathPrefix, op, "sizes"],
				message: "provide sizes, arbitrarySize, or autoSize",
			});
		}
	}
}

function validateVideoOperationRequirements(
	value: z.infer<typeof operationProfilesSchema>,
	ctx: z.RefinementCtx,
	pathPrefix: Array<string | number> = [],
): void {
	const entry = value["video.generate"];
	if (!entry) return;
	if (!entry.durations || entry.durations.length === 0) {
		ctx.addIssue({
			code: "custom",
			path: [...pathPrefix, "video.generate", "durations"],
			message: "required for video operations",
		});
	}
	if (!entry.sizes || Object.keys(entry.sizes).length === 0) {
		ctx.addIssue({
			code: "custom",
			path: [...pathPrefix, "video.generate", "sizes"],
			message: "required for video operations",
		});
	}
}

export const customCatalogEntrySchema = catalogEntrySchema.superRefine(
	(value, ctx) => {
		const text = value.operations["text.generate"];
		if (text !== undefined) {
			const capabilities = requiredCapabilitiesSchema.safeParse(
				text.capabilities,
			);
			if (!capabilities.success) {
				ctx.addIssue({
					code: "custom",
					path: ["operations", "text.generate", "capabilities"],
					message:
						"required with tools, vision, reasoning and structuredOutputs for custom text models",
				});
			} else if (capabilities.data.reasoning && text.reasoning === undefined) {
				ctx.addIssue({
					code: "custom",
					path: ["operations", "text.generate", "reasoning"],
					message: "required when capabilities.reasoning is true",
				});
			} else if (!capabilities.data.reasoning && text.reasoning !== undefined) {
				ctx.addIssue({
					code: "custom",
					path: ["operations", "text.generate", "reasoning"],
					message: "only allowed when capabilities.reasoning is true",
				});
			}
		}
		validateImageOperationRequirements(value.operations, ctx, ["operations"]);
		validateVideoOperationRequirements(value.operations, ctx, ["operations"]);
	},
);

export const transportOverridesSchema = z.partialRecord(
	z.enum(OPERATION_IDS),
	z.string().min(1),
);
