import { summaryVisible, toUpstreamReasoningEffort } from "#core/reasoning.ts";
import { mergeExtraBody, mergeExtraBodyDeep } from "#core/extraBody.ts";
import { type BaseCreds, requireApiKeyCreds } from "#adapters/creds.ts";
import { imageProfileFor, videoProfileFor } from "#catalog/types.ts";
import { mapUpstreamHttpError } from "#adapters/upstreamError.ts";
import { upstreamFetch } from "#gateway/instrumentedTransport.ts";
import { looksLikeContextWindowError } from "#core/httpError.ts";
import { resolveAdapterReasoning } from "#adapters/reasoning.ts";
import { toGeminiSchema, toGeminiJsonSchema } from "./schema.ts";
import type { ReasoningControlKind } from "#core/reasoning.ts";
import { GatewayError } from "#core/errors.ts";
import { readFile } from "node:fs/promises";
import type { Usage } from "#core/usage.ts";
import { randomUUID } from "node:crypto";
import { parseSSE } from "#core/sse.ts";

import {
	type CanonicalVideoProviderJob,
	type CanonicalVideoRequest,
	type VideoAssetVariant,
	type VideoUrlReference,
	type VideoStatus,
	resolveVideoSize,
} from "#core/videos.ts";

import type {
	CanonicalChatStreamChunk,
	CanonicalChatResponse,
	CanonicalFinishReason,
	CanonicalChatRequest,
	CanonicalContentPart,
	CanonicalMessage,
} from "#core/canonical.ts";

import type {
	EmbeddingsHandler,
	AdapterContext,
	ProviderModule,
	VideoHandler,
	ImageHandler,
	ChatHandler,
	Adapter,
} from "#adapters/types.ts";

import {
	providerFieldsWithGoogleContentParts,
	googleContentPartsFromProviderFields,
} from "#core/providerSpecificFields.ts";

import type {
	CanonicalEmbeddingsResponse,
	CanonicalEmbeddingsRequest,
	EmbeddingInput,
} from "#core/embeddings.ts";

import {
	type CanonicalImageResponse,
	type CanonicalImageRequest,
	resolveImageSize,
} from "#core/images.ts";

import {
	adapterContextDiagnostics,
	attachAdapterDiagnostics,
} from "#adapters/diagnostics.ts";

/**
 * Adapter for Google AI Studio (Gemini, generateContent API). A protocol quite different from
 * OpenAI: contents/parts/role 'model', systemInstruction, generationConfig, functionCall.
 * Demonstrates that the public OpenAI contract is independent of the upstream.
 */

type GoogleCreds = BaseCreds;

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_BODY_MANAGED_KEYS = [
	"model",
	"contents",
	"systemInstruction",
	"generationConfig",
	"tools",
	"toolConfig",
] as const;
const DEFAULT_GEMINI_BUDGETS = {
	minimal: 512,
	low: 1_024,
	medium: 4_096,
	high: 8_192,
	xhigh: 24_576,
} as const;
// Safety filters default to fully OFF from the gateway side. A client can still override them
// per-request via `extra_body.safetySettings` (not a managed key, so the shallow extra_body merge
// wins). `OFF` disables the filter entirely (unlike `BLOCK_NONE`, which still scores but never blocks).
const DEFAULT_SAFETY_SETTINGS = [
	{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
	{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
	{ category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
	{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
	{ category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" },
] as const;

function creds(ctx: AdapterContext): GoogleCreds & { apiKey: string } {
	return requireApiKeyCreds<GoogleCreds>(ctx.credentials, "Google adapter");
}

/* --------------------------------------------------- canonical -> Gemini body */

function dataUrlToInline(
	url: string,
): { mimeType: string; data: string } | null {
	const m = /^data:([^;]+);base64,(.*)$/s.exec(url);
	if (!m) return null;
	return { mimeType: m[1]!, data: m[2]! };
}

function partToGemini(p: CanonicalContentPart): Record<string, unknown> {
	switch (p.type) {
		case "text":
			return { text: p.text };
		case "image": {
			const inline = dataUrlToInline(p.url);
			if (!inline) {
				throw new GatewayError({
					class: "bad_request",
					deploymentHealth: "neutral",
					message:
						"Google adapter: images are only supported as base64 data URLs (not http URLs)",
					param: "messages",
				});
			}
			return { inlineData: inline };
		}
		case "audio":
			return {
				inlineData: {
					mimeType: p.format === "mp3" ? "audio/mpeg" : "audio/wav",
					data: p.data,
				},
			};
		case "file": {
			if (p.fileData) {
				const inline = dataUrlToInline(p.fileData);
				if (inline) return { inlineData: inline };
			}
			throw new GatewayError({
				class: "bad_request",
				deploymentHealth: "neutral",
				message:
					"Google adapter: 'file' is only supported as a file_data base64 data URL",
				param: "messages",
			});
		}
	}
}

function contentToParts(
	content: CanonicalMessage["content"],
): Record<string, unknown>[] {
	if (content === null) return [];
	if (typeof content === "string") return [{ text: content }];
	return content.map(partToGemini);
}

function googleToolCallExtra(toolCall: {
	extraContent?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
	const google = toolCall.extraContent?.google;
	if (google === null || typeof google !== "object" || Array.isArray(google))
		return undefined;
	return google as Record<string, unknown>;
}

function googleThoughtSignature(toolCall: {
	extraContent?: Record<string, unknown>;
}): string | undefined {
	const google = googleToolCallExtra(toolCall);
	const signature = google?.thought_signature ?? google?.thoughtSignature;
	return typeof signature === "string" && signature.length > 0
		? signature
		: undefined;
}

// Google documents this sentinel for injected/migrated Gemini 3 function calls whose original
// encrypted signature is unavailable. It keeps existing conversations usable; fresh gateway
// responses still replay the exact signature through the stateless public carriers.
const MISSING_THOUGHT_SIGNATURE = "skip_thought_signature_validator";

function isGemini3OrNewerModel(ctx: AdapterContext): boolean {
	const model = ctx.upstreamModel.toLowerCase();
	return /(?:^|[/_-])gemini-(?:[3-9]|[1-9]\d)(?:[._-]|$)/.test(model);
}

function requiresThoughtSignature(ctx: AdapterContext): boolean {
	return (
		ctx.meta.reasoning?.kind === "gemini_level" || isGemini3OrNewerModel(ctx)
	);
}

function supportsStrictToolCalling(ctx: AdapterContext): boolean {
	return isGemini3OrNewerModel(ctx);
}

function ensureFirstFunctionCallSignature(
	parts: Record<string, unknown>[],
	ctx: AdapterContext,
): void {
	if (!requiresThoughtSignature(ctx)) return;
	const first = parts.find((part) => part.functionCall !== undefined);
	if (first === undefined) return;
	const signature = first.thoughtSignature ?? first.thought_signature;
	if (typeof signature !== "string" || signature.length === 0)
		first.thoughtSignature = MISSING_THOUGHT_SIGNATURE;
}

interface GeminiBody extends Record<string, unknown> {
	contents: Array<{ role: "user" | "model"; parts: Record<string, unknown>[] }>;
	systemInstruction?: { parts: Record<string, unknown>[] };
	generationConfig?: Record<string, unknown>;
	tools?: Array<{ functionDeclarations: Record<string, unknown>[] }>;
	toolConfig?: Record<string, unknown>;
}

function geminiThinkingConfig(
	req: CanonicalChatRequest,
	ctx: AdapterContext,
): Record<string, unknown> | undefined {
	const resolved = resolveAdapterReasoning(req, ctx, [
		"gemini_level",
		"gemini_budget",
	]);
	if (resolved === undefined) return undefined;
	const { effort } = resolved;
	const spec = ctx.meta.reasoning!;
	const includeThoughts = summaryVisible(resolved.summary);
	if (spec.kind === "gemini_level") {
		const level =
			effort === "none" ? "minimal" : toUpstreamReasoningEffort(effort, spec);
		return {
			thinkingLevel: level === "xhigh" ? "high" : level,
			...(includeThoughts ? { includeThoughts: true } : {}),
		};
	}
	if (effort === "none") return { thinkingBudget: 0 };
	const budget =
		spec.budgets?.[effort] ??
		(effort === "max" ? undefined : DEFAULT_GEMINI_BUDGETS[effort]);
	if (budget === undefined) {
		throw new Error(
			'Gemini budget-based reasoning requires an explicit budget for effort "max"',
		);
	}
	return {
		thinkingBudget: budget,
		...(includeThoughts ? { includeThoughts: true } : {}),
	};
}

function applyResponseFormat(
	gen: Record<string, unknown>,
	req: CanonicalChatRequest,
): void {
	const format = req.responseFormat;
	if (format === undefined || format.type === "text") return;

	// JSON output in Gemini = generationConfig.responseMimeType (+ responseJsonSchema for the schema).
	// There is no `responseFormat` in the generateContent API. `responseJsonSchema` accepts standard
	// JSON Schema (lowercase types, additionalProperties, $ref), unlike `responseSchema` (an OpenAPI
	// `responseSchema` (subset with UPPERCASE types). Works for Gemini 2.5 and 3.
	gen.responseMimeType = "application/json";
	if (format.type === "json_schema") gen.responseJsonSchema = format.schema;
}

function buildGeminiBody(
	req: CanonicalChatRequest,
	ctx: AdapterContext,
): GeminiBody {
	const body: GeminiBody = { contents: [] };
	const strictToolDecoding =
		supportsStrictToolCalling(ctx) &&
		req.tools?.some((tool) => tool.strict === true) === true;
	const systemParts: Record<string, unknown>[] = [];
	// Map toolCallId -> function name (to map tool results).
	const toolNameById = new Map<string, string>();

	for (const m of req.messages) {
		if (m.role === "system" || m.role === "developer") {
			systemParts.push(...contentToParts(m.content));
			continue;
		}
		if (m.role === "assistant") {
			const nativeParts = googleContentPartsFromProviderFields(
				m.providerFields,
			);
			const parts: Record<string, unknown>[] = nativeParts ?? [];
			for (const part of nativeParts ?? []) {
				const call = part.functionCall as
					| { id?: unknown; name?: unknown }
					| undefined;
				if (typeof call?.id === "string" && typeof call.name === "string")
					toolNameById.set(call.id, call.name);
			}
			if (nativeParts === undefined && m.content)
				parts.push(...contentToParts(m.content));
			for (const tc of m.toolCalls ?? []) {
				toolNameById.set(tc.id, tc.name);
				if (nativeParts !== undefined) continue;
				let args: unknown = {};
				try {
					args = tc.arguments ? JSON.parse(tc.arguments) : {};
				} catch {
					args = {};
				}
				const functionCall: Record<string, unknown> = {
					id: tc.id,
					name: tc.name,
					args,
				};
				const part: Record<string, unknown> = { functionCall };
				const thoughtSignature = googleThoughtSignature(tc);
				if (thoughtSignature !== undefined)
					part.thoughtSignature = thoughtSignature;
				parts.push(part);
			}
			ensureFirstFunctionCallSignature(parts, ctx);
			body.contents.push({ role: "model", parts });
			continue;
		}
		if (m.role === "tool") {
			const name = m.toolCallId
				? (toolNameById.get(m.toolCallId) ?? "tool")
				: "tool";
			const text =
				typeof m.content === "string"
					? m.content
					: JSON.stringify(m.content ?? "");
			let response: Record<string, unknown>;
			try {
				const parsed: unknown = JSON.parse(text);
				// Gemini's FunctionResponse.response is a protobuf Struct, so its root must be an object.
				response = plainRecord(parsed) ?? { output: parsed };
			} catch {
				response = { result: text };
			}
			body.contents.push({
				role: "user",
				parts: [
					{
						functionResponse: {
							name,
							response,
							...(m.toolCallId ? { id: m.toolCallId } : {}),
						},
					},
				],
			});
			continue;
		}
		// user
		body.contents.push({ role: "user", parts: contentToParts(m.content) });
	}

	if (systemParts.length > 0) body.systemInstruction = { parts: systemParts };

	const gen: Record<string, unknown> = {};
	if (req.temperature !== undefined) gen.temperature = req.temperature;
	if (req.topP !== undefined) gen.topP = req.topP;
	const extraTopK = req.extraBody?.top_k;
	if (req.topK !== undefined) gen.topK = req.topK;
	else if (typeof extraTopK === "number") gen.topK = extraTopK;
	if (req.maxTokens !== undefined) gen.maxOutputTokens = req.maxTokens;
	if (req.stop !== undefined) gen.stopSequences = req.stop;
	if (req.n !== undefined) gen.candidateCount = req.n;
	if (req.presencePenalty !== undefined)
		gen.presencePenalty = req.presencePenalty;
	if (req.frequencyPenalty !== undefined)
		gen.frequencyPenalty = req.frequencyPenalty;
	if (req.seed !== undefined) gen.seed = req.seed;
	const thinkingConfig = geminiThinkingConfig(req, ctx);
	if (thinkingConfig !== undefined) gen.thinkingConfig = thinkingConfig;
	applyResponseFormat(gen, req);
	if (Object.keys(gen).length > 0) body.generationConfig = gen;

	if (req.tools && req.tools.length > 0) {
		body.tools = [
			{
				functionDeclarations: req.tools.map((t) => ({
					name: t.name,
					...(t.description !== undefined
						? { description: t.description }
						: {}),
					...(t.parameters === undefined
						? {}
						: t.strict === true && strictToolDecoding
							? { parametersJsonSchema: toGeminiJsonSchema(t.parameters) }
							: { parameters: toGeminiSchema(t.parameters) }),
				})),
			},
		];
	}
	if (req.toolChoice !== undefined || strictToolDecoding) {
		const fc: Record<string, unknown> = {};
		const toolChoice = req.toolChoice ?? "auto";
		if (toolChoice === "auto")
			fc.mode = strictToolDecoding ? "VALIDATED" : "AUTO";
		else if (toolChoice === "none") fc.mode = "NONE";
		else if (toolChoice === "required") fc.mode = "ANY";
		else if ("name" in toolChoice) {
			fc.mode = "ANY";
			fc.allowedFunctionNames = [toolChoice.name];
		} else {
			fc.mode =
				toolChoice.mode === "required"
					? "ANY"
					: strictToolDecoding
						? "VALIDATED"
						: "AUTO";
			fc.allowedFunctionNames = toolChoice.allowedTools;
		}
		body.toolConfig = { functionCallingConfig: fc };
	}

	body.safetySettings = DEFAULT_SAFETY_SETTINGS.map((s) => ({ ...s }));
	const extraBody = req.extraBody ? { ...req.extraBody } : undefined;
	if (extraBody !== undefined) delete extraBody.top_k;
	return mergeExtraBody(body, extraBody, GEMINI_BODY_MANAGED_KEYS);
}

/* --------------------------------------------------- Gemini -> canonical parse */

function mapGeminiFinish(
	reason: unknown,
	hasToolCalls: boolean,
): CanonicalFinishReason | null {
	switch (reason) {
		case "STOP":
			return hasToolCalls ? "tool_calls" : "stop";
		case "MAX_TOKENS":
			return "length";
		case "SAFETY":
		case "RECITATION":
		case "PROHIBITED_CONTENT":
		case "BLOCKLIST":
		case "SPII":
		case "IMAGE_SAFETY":
		case "IMAGE_PROHIBITED_CONTENT":
		case "IMAGE_RECITATION":
			return "content_filter";
		case "MALFORMED_FUNCTION_CALL":
		case "UNEXPECTED_TOOL_CALL":
		case "TOO_MANY_TOOL_CALLS":
			throw new GatewayError({
				class: "server",
				code: "upstream_invalid_tool_call",
				message: `Gemini could not produce a valid tool call: ${reason}`,
				failureKind: "transient",
				// The model produced a bad candidate, but the credential/deployment is alive.
				deploymentHealth: "neutral",
				provider: { body: { finishReason: reason } },
			});
		case undefined:
		case null:
			return null;
		default:
			throw new GatewayError({
				class: "server",
				code: "upstream_protocol_error",
				message: `Gemini returned an unknown finish reason: ${String(reason)}`,
				failureKind: "transient",
				deploymentHealth: "penalize",
				provider: { body: { finishReason: reason } },
			});
	}
}

interface GeminiPart {
	text?: string;
	/** Reasoning (thinking) part. NOT visible content: excluded from output. */
	thought?: boolean;
	thoughtSignature?: string;
	thought_signature?: string;
	functionCall?: { id?: string; name?: string; args?: unknown };
	inlineData?: { mimeType?: string; data?: string };
}
interface GeminiCandidate {
	content?: { parts?: GeminiPart[] };
	finishReason?: string;
	index?: number;
}
interface GeminiUsage {
	promptTokenCount?: number;
	candidatesTokenCount?: number;
	totalTokenCount?: number;
	cachedContentTokenCount?: number;
	thoughtsTokenCount?: number;
}
interface GeminiResponse {
	candidates?: GeminiCandidate[];
	promptFeedback?: {
		blockReason?: string;
		blockReasonMessage?: string;
		safetyRatings?: unknown;
	};
	usageMetadata?: GeminiUsage;
	responseId?: string;
	modelVersion?: string;
}
interface GeminiEmbeddingUsage {
	promptTokenCount?: number;
}
interface GeminiEmbedding {
	values?: unknown;
}
interface GeminiEmbeddingResponse {
	embedding?: GeminiEmbedding;
	embeddings?: GeminiEmbedding[];
	usageMetadata?: GeminiEmbeddingUsage;
}

async function buildGeminiImageBody(
	req: CanonicalImageRequest,
	ctx: AdapterContext,
): Promise<Record<string, unknown>> {
	const parts: Record<string, unknown>[] = [{ text: req.prompt }];
	for (const image of req.images ?? []) {
		parts.push({
			inlineData: {
				mimeType: image.mimeType,
				data: (await readFile(image.path)).toString("base64"),
			},
		});
	}
	const imageConfig: Record<string, unknown> = {};
	const profile = imageProfileFor(ctx.meta, req.operation);
	const resolved = resolveImageSize(req, profile);
	const qualityMapping = profile?.qualityMappings?.[req.quality ?? "auto"];
	if (resolved?.aspectRatio) imageConfig.aspectRatio = resolved.aspectRatio;
	if (resolved?.imageSize) imageConfig.imageSize = resolved.imageSize;
	const body: Record<string, unknown> = {
		contents: [{ role: "user", parts }],
		generationConfig: {
			responseModalities: ["IMAGE"],
			...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
			...(qualityMapping?.thinkingLevel
				? { thinkingConfig: { thinkingLevel: qualityMapping.thinkingLevel } }
				: {}),
		},
	};
	return mergeExtraBodyDeep(body, req.extraBody, [
		"contents",
		"generationConfig.responseModalities",
		...(resolved?.aspectRatio
			? ["generationConfig.imageConfig.aspectRatio"]
			: []),
		...(resolved?.imageSize ? ["generationConfig.imageConfig.imageSize"] : []),
		...(qualityMapping?.thinkingLevel
			? ["generationConfig.thinkingConfig.thinkingLevel"]
			: []),
	]);
}

function googleModelResource(upstreamModel: string): string {
	return upstreamModel.startsWith("models/")
		? upstreamModel
		: `models/${upstreamModel}`;
}

function googleModelPathId(upstreamModel: string): string {
	return upstreamModel.startsWith("models/")
		? upstreamModel.slice("models/".length)
		: upstreamModel;
}

function googleEmbeddingTexts(input: EmbeddingInput): string[] {
	if (typeof input === "string") return [input];
	if (input.every((item) => typeof item === "string")) return input as string[];
	throw new GatewayError({
		class: "bad_request",
		message:
			"Google embeddings only support string inputs through the OpenAI-compatible contract.",
		code: "unsupported_parameter",
		param: "input",
		publicMessage:
			"Google embeddings only support string inputs through the OpenAI-compatible contract.",
	});
}

function textEmbeddingContent(text: string): Record<string, unknown> {
	return { parts: [{ text }] };
}

function plainRecord(value: unknown): Record<string, unknown> | null {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return null;
	return value as Record<string, unknown>;
}

function splitGoogleEmbeddingExtraBody(req: CanonicalEmbeddingsRequest): {
	embedContentConfig?: Record<string, unknown>;
	extraBody?: Record<string, unknown>;
} {
	const extra = req.extraBody;
	const config: Record<string, unknown> = {};
	const rest: Record<string, unknown> = {};
	if (extra !== undefined) {
		for (const [key, value] of Object.entries(extra)) {
			if (key !== "embedContentConfig") {
				rest[key] = value;
				continue;
			}
			const incomingConfig = plainRecord(value);
			if (!incomingConfig) {
				throw new GatewayError({
					class: "bad_request",
					message: "extra_body.embedContentConfig must be an object",
					code: "invalid_extra_body",
					param: "extra_body.embedContentConfig",
				});
			}
			Object.assign(config, incomingConfig);
		}
	}
	if (
		req.dimensions !== undefined &&
		config.outputDimensionality !== undefined
	) {
		throw new GatewayError({
			class: "bad_request",
			message:
				'extra_body.embedContentConfig.outputDimensionality collides with managed request parameter "dimensions"',
			code: "invalid_extra_body",
			param: "extra_body.embedContentConfig.outputDimensionality",
		});
	}
	if (req.dimensions !== undefined)
		config.outputDimensionality = req.dimensions;

	return {
		...(Object.keys(config).length > 0 ? { embedContentConfig: config } : {}),
		...(Object.keys(rest).length > 0 ? { extraBody: rest } : {}),
	};
}

function googleEmbeddingRequestBody(
	req: CanonicalEmbeddingsRequest,
	ctx: AdapterContext,
): {
	body: Record<string, unknown>;
	method: "embedContent" | "batchEmbedContents";
} {
	const texts = googleEmbeddingTexts(req.input);
	const model = googleModelResource(ctx.upstreamModel);
	const { embedContentConfig, extraBody } = splitGoogleEmbeddingExtraBody(req);
	const requestFor = (text: string): Record<string, unknown> => ({
		model,
		content: textEmbeddingContent(text),
		...(embedContentConfig ? { embedContentConfig } : {}),
	});

	if (texts.length === 1) {
		return {
			method: "embedContent",
			body: mergeExtraBodyDeep(requestFor(texts[0]!), extraBody, [
				"model",
				"content",
				"outputDimensionality",
				"taskType",
				"title",
			]),
		};
	}

	return {
		method: "batchEmbedContents",
		body: mergeExtraBodyDeep({ requests: texts.map(requestFor) }, extraBody, [
			"requests",
			"model",
			"content",
			"outputDimensionality",
			"taskType",
			"title",
		]),
	};
}

function parseGeminiImageResponse(raw: unknown): CanonicalImageResponse {
	const response = (raw ?? {}) as GeminiResponse;
	const data = (response.candidates ?? [])
		.flatMap((candidate) => candidate.content?.parts ?? [])
		.flatMap((part) => {
			const inlineData = part.inlineData;
			if (typeof inlineData?.data !== "string") return [];
			return [
				{
					b64Json: inlineData.data,
					...(typeof inlineData.mimeType === "string"
						? { mimeType: inlineData.mimeType }
						: {}),
				},
			];
		});
	if (data.length === 0)
		throw new GatewayError({
			class: "server",
			message: "Google returned no image parts",
		});
	const u = response.usageMetadata;
	const usage =
		u?.totalTokenCount !== undefined
			? {
					inputTokens: u.promptTokenCount ?? 0,
					outputTokens:
						(u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
					totalTokens: u.totalTokenCount,
				}
			: undefined;
	return {
		created: Math.floor(Date.now() / 1000),
		data,
		...(usage ? { usage } : {}),
	};
}

function parseEmbeddingValues(value: unknown): number[] {
	if (
		!Array.isArray(value) ||
		value.some((item) => typeof item !== "number" || !Number.isFinite(item))
	) {
		throw new GatewayError({
			class: "server",
			message: "Google returned an invalid embedding vector",
		});
	}
	return value as number[];
}

function parseGeminiEmbeddingsResponse(
	raw: unknown,
	ctx: AdapterContext,
): CanonicalEmbeddingsResponse {
	const response = (raw ?? {}) as GeminiEmbeddingResponse;
	const embeddings =
		response.embeddings ??
		(response.embedding !== undefined ? [response.embedding] : []);
	if (embeddings.length === 0) {
		throw new GatewayError({
			class: "server",
			message: "Google returned no embeddings",
		});
	}
	const promptTokens = response.usageMetadata?.promptTokenCount;
	return {
		model: ctx.upstreamModel,
		data: embeddings.map((embedding, index) => ({
			index,
			embedding: parseEmbeddingValues(embedding.values),
		})),
		...(promptTokens !== undefined
			? { usage: { promptTokens, totalTokens: promptTokens } }
			: {}),
	};
}

function googleRetryAfterMs(
	_status: number,
	body: unknown,
): number | undefined {
	const details = (body as { error?: { details?: unknown } })?.error?.details;
	if (!Array.isArray(details)) return undefined;
	for (const detail of details) {
		if (detail === null || typeof detail !== "object") continue;
		const record = detail as Record<string, unknown>;
		if (
			record["@type"] !== "type.googleapis.com/google.rpc.RetryInfo" ||
			typeof record.retryDelay !== "string"
		)
			continue;
		const match = /^(\d+(?:\.\d+)?)s$/.exec(record.retryDelay);
		if (!match) continue;
		const seconds = Number(match[1]);
		if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
	}
	return undefined;
}

function mapGoogleError(err: unknown): GatewayError {
	return mapUpstreamHttpError(err, {
		label: "Google",
		refineBadRequest: (message) =>
			looksLikeContextWindowError(message) ? "context_window" : null,
		retryAfterMs: googleRetryAfterMs,
	});
}

function mapGeminiUsage(u: GeminiUsage | undefined): Usage {
	const thoughts = u?.thoughtsTokenCount ?? 0;
	// OpenAI semantics: completion_tokens includes the reasoning tokens. Gemini reports
	// candidatesTokenCount (visible output) and thoughtsTokenCount separately, so we add them.
	const completion = (u?.candidatesTokenCount ?? 0) + thoughts;
	const usage: Usage = {
		promptTokens: u?.promptTokenCount ?? 0,
		completionTokens: completion,
		totalTokens: u?.totalTokenCount ?? (u?.promptTokenCount ?? 0) + completion,
	};
	if (u?.cachedContentTokenCount !== undefined)
		usage.cacheReadTokens = u.cachedContentTokenCount;
	if (thoughts > 0) usage.reasoningTokens = thoughts;
	return usage;
}

function geminiPartThoughtSignature(part: GeminiPart): string | undefined {
	const signature = part.thoughtSignature ?? part.thought_signature;
	return typeof signature === "string" && signature.length > 0
		? signature
		: undefined;
}

function geminiToolCallExtra(
	part: GeminiPart,
): Record<string, unknown> | undefined {
	const signature = geminiPartThoughtSignature(part);
	if (signature === undefined) return undefined;
	return { google: { thought_signature: signature } };
}

function candidateToChoice(
	c: GeminiCandidate,
	index: number,
): CanonicalChatResponse["choices"][number] {
	const parts = c.content?.parts ?? [];
	const texts: string[] = [];
	const reasoning: string[] = [];
	const toolCalls: NonNullable<
		CanonicalChatResponse["choices"][number]["message"]["toolCalls"]
	> = [];
	for (const [i, p] of parts.entries()) {
		if (p.text !== undefined && !p.thought) texts.push(p.text);
		if (p.text !== undefined && p.thought) reasoning.push(p.text);
		if (p.functionCall) {
			const extraContent = geminiToolCallExtra(p);
			toolCalls.push({
				id: p.functionCall.id ?? `call_${index}_${i}`,
				name: p.functionCall.name ?? "",
				arguments: JSON.stringify(p.functionCall.args ?? {}),
				...(extraContent !== undefined ? { extraContent } : {}),
			});
		}
	}
	const message: CanonicalChatResponse["choices"][number]["message"] = {
		role: "assistant",
		content: texts.length > 0 ? texts.join("") : null,
	};
	if (reasoning.length > 0) message.reasoning = reasoning.join("");
	if (toolCalls.length > 0) message.toolCalls = toolCalls;
	if (parts.some((part) => geminiPartThoughtSignature(part) !== undefined))
		message.providerFields = providerFieldsWithGoogleContentParts(
			parts as unknown as Record<string, unknown>[],
		);
	return {
		index: c.index ?? index,
		finishReason: mapGeminiFinish(c.finishReason, toolCalls.length > 0),
		message,
	};
}

function parseGeminiResponse(
	raw: unknown,
	ctx: AdapterContext,
): CanonicalChatResponse {
	const r = (raw ?? {}) as GeminiResponse;
	if ((r.candidates?.length ?? 0) === 0) {
		if (r.promptFeedback?.blockReason) {
			return attachAdapterDiagnostics(
				{
					id: r.responseId ?? `gen-${randomUUID()}`,
					created: Math.floor(Date.now() / 1000),
					model: r.modelVersion ?? ctx.upstreamModel,
					choices: [
						{
							index: 0,
							finishReason: "content_filter",
							message: { role: "assistant", content: null },
						},
					],
					usage: mapGeminiUsage(r.usageMetadata),
				},
				{
					...(r.responseId ? { providerRequestId: r.responseId } : {}),
					...(r.modelVersion ? { modelVersion: r.modelVersion } : {}),
					originalTerminalReason: r.promptFeedback.blockReason,
					metadata: {
						promptFeedback: { blockReason: r.promptFeedback.blockReason },
					},
				},
			);
		}
		throw new GatewayError({
			class: "server",
			code: "upstream_protocol_error",
			message:
				"Gemini returned no candidates and no promptFeedback block reason",
			provider: { body: r },
		});
	}
	const response: CanonicalChatResponse = {
		id: r.responseId ?? `gen-${randomUUID()}`,
		created: Math.floor(Date.now() / 1000),
		model: r.modelVersion ?? ctx.upstreamModel,
		choices: (r.candidates ?? []).map(candidateToChoice),
		usage: mapGeminiUsage(r.usageMetadata),
	};
	const originalTerminalReason = r.candidates?.find(
		(candidate) => candidate.finishReason != null,
	)?.finishReason;
	return attachAdapterDiagnostics(response, {
		...(r.responseId ? { providerRequestId: r.responseId } : {}),
		...(r.modelVersion ? { modelVersion: r.modelVersion } : {}),
		...(originalTerminalReason ? { originalTerminalReason } : {}),
	});
}

const chat: ChatHandler = {
	buildRequest(req, ctx) {
		const c = creds(ctx);
		const base = (c.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
		const method = req.stream
			? "streamGenerateContent?alt=sse"
			: "generateContent";
		return {
			method: "POST",
			url: `${base}/models/${encodeURIComponent(ctx.upstreamModel)}:${method}`,
			headers: {
				"content-type": "application/json",
				"x-goog-api-key": c.apiKey,
				...(c.headers ?? {}),
			},
			body: JSON.stringify(buildGeminiBody(req, ctx)),
		};
	},

	parseResponse(raw, ctx) {
		return parseGeminiResponse(raw, ctx);
	},

	async *parseStream(stream, ctx) {
		const id = `gen-${randomUUID()}`;
		const created = Math.floor(Date.now() / 1000);
		const roleSent = new Set<number>();
		const contentParts = new Map<number, Record<string, unknown>[]>();
		for await (const event of parseSSE(stream)) {
			if (event.data === "[DONE]") {
				adapterContextDiagnostics(ctx).transportTerminator = "done_marker";
				return;
			}
			let json: GeminiResponse;
			try {
				json = JSON.parse(event.data) as GeminiResponse;
			} catch (cause) {
				throw new GatewayError({
					class: "server",
					code: "upstream_protocol_error",
					message: "Gemini emitted malformed JSON in its stream",
					provider: { body: event.data },
					cause,
				});
			}
			if (
				(json.candidates?.length ?? 0) === 0 &&
				json.promptFeedback?.blockReason
			) {
				yield attachAdapterDiagnostics(
					{
						id,
						created,
						model: json.modelVersion ?? ctx.upstreamModel,
						choices: [
							{
								index: 0,
								delta: {},
								finishReason: "content_filter",
							},
						],
						...(json.usageMetadata
							? { usage: mapGeminiUsage(json.usageMetadata) }
							: {}),
					},
					{
						...(json.modelVersion ? { modelVersion: json.modelVersion } : {}),
						metadata: {
							promptFeedback: {
								blockReason: json.promptFeedback.blockReason,
							},
						},
					},
				);
				continue;
			}
			if ((json.candidates?.length ?? 0) === 0) {
				const metadataChunk: CanonicalChatStreamChunk = {
					id,
					created,
					model: json.modelVersion ?? ctx.upstreamModel,
					choices: [],
					...(json.usageMetadata
						? { usage: mapGeminiUsage(json.usageMetadata) }
						: {}),
				};
				yield attachAdapterDiagnostics(metadataChunk, {
					...(json.modelVersion ? { modelVersion: json.modelVersion } : {}),
					...(json.responseId ? { providerRequestId: json.responseId } : {}),
					metadata: { candidatesAbsent: true },
				});
				continue;
			}
			const choices = (json.candidates ?? []).map(
				(candidate, fallbackIndex) => {
					const index = candidate.index ?? fallbackIndex;
					const parts = candidate.content?.parts ?? [];
					const accumulated = contentParts.get(index) ?? [];
					accumulated.push(
						...(parts as unknown as Record<string, unknown>[]).map((part) =>
							structuredClone(part),
						),
					);
					contentParts.set(index, accumulated);
					const text = parts
						.filter((part) => !part.thought)
						.map((part) => part.text ?? "")
						.join("");
					const reasoning = parts
						.filter((part) => part.thought)
						.map((part) => part.text ?? "")
						.join("");
					const hasToolCall = parts.some((part) => part.functionCall);
					const hasAccumulatedToolCall = accumulated.some(
						(part) => (part as GeminiPart).functionCall,
					);
					const delta: CanonicalChatStreamChunk["choices"][number]["delta"] =
						{};
					if (!roleSent.has(index)) {
						delta.role = "assistant";
						roleSent.add(index);
					}
					if (text) delta.content = text;
					if (reasoning) delta.reasoning = reasoning;
					if (hasToolCall) {
						delta.toolCalls = parts
							.filter((part) => part.functionCall)
							.map((part, toolIndex) => {
								const extraContent = geminiToolCallExtra(part);
								return {
									index: toolIndex,
									id: part.functionCall!.id ?? `call_${index}_${toolIndex}`,
									name: part.functionCall!.name ?? "",
									arguments: JSON.stringify(part.functionCall!.args ?? {}),
									...(extraContent !== undefined ? { extraContent } : {}),
								};
							});
					}
					if (
						candidate.finishReason != null &&
						accumulated.some((part) =>
							geminiPartThoughtSignature(part as GeminiPart),
						)
					)
						delta.providerFields =
							providerFieldsWithGoogleContentParts(accumulated);
					return {
						index,
						delta,
						finishReason: mapGeminiFinish(
							candidate.finishReason,
							hasAccumulatedToolCall,
						),
					};
				},
			);
			const chunk: CanonicalChatStreamChunk = {
				id,
				created,
				model: json.modelVersion ?? ctx.upstreamModel,
				choices,
			};
			if (json.usageMetadata) chunk.usage = mapGeminiUsage(json.usageMetadata);
			const originalTerminalReason = json.candidates?.find(
				(candidate) => candidate.finishReason != null,
			)?.finishReason;
			yield attachAdapterDiagnostics(chunk, {
				...(json.modelVersion ? { modelVersion: json.modelVersion } : {}),
				...(originalTerminalReason ? { originalTerminalReason } : {}),
				...(json.responseId ? { providerRequestId: json.responseId } : {}),
			});
		}
	},

	mapError(err) {
		return mapGoogleError(err);
	},
};

const imageHandler: ImageHandler = {
	async buildRequest(req, ctx) {
		const c = creds(ctx);
		const base = (c.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
		return {
			method: "POST",
			url: `${base}/models/${encodeURIComponent(ctx.upstreamModel)}:generateContent`,
			headers: {
				"content-type": "application/json",
				"x-goog-api-key": c.apiKey,
				...(c.headers ?? {}),
			},
			body: JSON.stringify(await buildGeminiImageBody(req, ctx)),
		};
	},
	parseResponse(raw) {
		return parseGeminiImageResponse(raw);
	},
	mapError(err) {
		return mapGoogleError(err);
	},
};

function googleVideoParameters(
	req: CanonicalVideoRequest,
	ctx: AdapterContext,
): Record<string, unknown> {
	const resolved = resolveVideoSize(req, videoProfileFor(ctx.meta));
	const seconds = req.seconds !== undefined ? Number(req.seconds) : undefined;
	const parameters: Record<string, unknown> = {
		...(seconds !== undefined && Number.isFinite(seconds)
			? { durationSeconds: seconds }
			: {}),
		...(resolved?.aspectRatio ? { aspectRatio: resolved.aspectRatio } : {}),
		...(resolved?.resolution ? { resolution: resolved.resolution } : {}),
		...(req.seed !== undefined ? { seed: req.seed } : {}),
		...(req.generateAudio !== undefined
			? { generateAudio: req.generateAudio }
			: {}),
	};
	return mergeExtraBody(parameters, req.extraBody, [
		"durationSeconds",
		"aspectRatio",
		"resolution",
		"seed",
		"generateAudio",
	]);
}

function googleVideoInline(
	url: string,
	param: string,
	mediaType: "image" | "video",
): {
	mimeType: string;
	data: string;
} {
	const inline = dataUrlToInline(url);
	if (!inline?.mimeType.startsWith(`${mediaType}/`)) {
		throw new GatewayError({
			class: "bad_request",
			message: `Google Veo transport requires ${mediaType} references as data:${mediaType}/... base64 URLs`,
			param,
		});
	}
	return inline;
}

function googleReferenceImages(refs: VideoUrlReference[]): Array<{
	image: { inlineData: { mimeType: string; data: string } };
	referenceType: "asset";
}> {
	return refs.map((ref) => ({
		image: {
			inlineData: googleVideoInline(ref.url, "input_references", "image"),
		},
		referenceType: "asset",
	}));
}

function assertGoogleVideoDuration(
	req: CanonicalVideoRequest,
	ctx: AdapterContext,
	hasReferenceImages: boolean,
	hasVideoExtension: boolean,
): void {
	const seconds = req.seconds !== undefined ? Number(req.seconds) : undefined;
	if (seconds === undefined || seconds === 8) return;
	const resolution = resolveVideoSize(
		req,
		videoProfileFor(ctx.meta),
	)?.resolution;
	const highResolution =
		resolution === "1080p" || resolution?.toLowerCase() === "4k";
	if (!highResolution && !hasReferenceImages && !hasVideoExtension) return;
	throw new GatewayError({
		class: "bad_request",
		code: "unsupported_parameter",
		param: "duration",
		message:
			"Google Veo requires an 8 second duration for 1080p/4K, reference images, and video extension.",
		publicMessage:
			"Google Veo requires an 8 second duration for 1080p/4K, reference images, and video extension.",
	});
}

function googleVideoBody(
	req: CanonicalVideoRequest,
	ctx: AdapterContext,
): Record<string, unknown> {
	const instance: Record<string, unknown> = { prompt: req.prompt };
	const refs = req.inputReferences ?? [];
	const imageRefs: VideoUrlReference[] = [];
	const videoRefs: VideoUrlReference[] = [];
	for (const ref of refs) {
		if (ref.type === "image_url") {
			imageRefs.push(ref);
			continue;
		}
		if (ref.type === "video_url") {
			videoRefs.push(ref);
			continue;
		}
		throw new GatewayError({
			class: "bad_request",
			message: `Google Veo transport does not support ${ref.type === "file_id" ? "file_id" : ref.type} references`,
			param: "input_references",
		});
	}
	if (
		videoRefs.length > 1 ||
		(videoRefs.length === 1 && imageRefs.length > 0)
	) {
		throw new GatewayError({
			class: "bad_request",
			message:
				"Google Veo transport accepts either one video reference or image references, not both",
			param: "input_references",
		});
	}
	if (videoRefs.length === 1 && (req.frameImages?.length ?? 0) > 0) {
		throw new GatewayError({
			class: "bad_request",
			message:
				"Google Veo transport cannot combine video extension with frame images",
			param: "frame_images",
		});
	}
	if (imageRefs.length > 1 && (req.frameImages?.length ?? 0) > 0) {
		throw new GatewayError({
			class: "bad_request",
			message:
				"Google Veo transport cannot combine reference images with frame images",
			param: "frame_images",
		});
	}
	const videoRef = videoRefs[0];
	if (videoRef) {
		instance.video = {
			inlineData: googleVideoInline(videoRef.url, "input_references", "video"),
		};
	} else if (imageRefs.length === 1) {
		instance.image = {
			inlineData: googleVideoInline(
				imageRefs[0]!.url,
				"input_references",
				"image",
			),
		};
	} else if (imageRefs.length > 1) {
		instance.referenceImages = googleReferenceImages(imageRefs);
	}
	assertGoogleVideoDuration(
		req,
		ctx,
		imageRefs.length > 1,
		videoRef !== undefined,
	);
	for (const frame of req.frameImages ?? []) {
		const target = frame.frame === "first" ? "image" : "lastFrame";
		if (instance[target] !== undefined) {
			throw new GatewayError({
				class: "bad_request",
				message:
					frame.frame === "first"
						? "Google Veo transport accepts a single first frame (image reference or first_frame image)"
						: "Google Veo transport accepts a single last_frame image",
				param: "frame_images",
			});
		}
		instance[target] = {
			inlineData: googleVideoInline(frame.url, "frame_images", "image"),
		};
	}
	const parameters = googleVideoParameters(req, ctx);
	return {
		instances: [instance],
		...(Object.keys(parameters).length > 0 ? { parameters } : {}),
	};
}

async function parseJsonResponse(res: Response): Promise<unknown> {
	const text = await res.text();
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

async function googleFetchJson(
	url: string,
	init: RequestInit,
	ctx: AdapterContext,
): Promise<unknown> {
	let res: Response;
	try {
		res = await upstreamFetch(ctx, url, init);
	} catch (err) {
		throw mapGoogleError(err);
	}
	if (!res.ok) {
		throw mapGoogleError({
			status: res.status,
			body: await parseJsonResponse(res),
		});
	}
	return parseJsonResponse(res);
}

function googleVideoUri(raw: Record<string, unknown>): string | undefined {
	const response = raw.response as Record<string, unknown> | undefined;
	const generateVideoResponse = response?.generateVideoResponse as
		| Record<string, unknown>
		| undefined;
	const samples = generateVideoResponse?.generatedSamples as
		| Array<Record<string, unknown>>
		| undefined;
	const sampleVideo = samples?.[0]?.video as
		| Record<string, unknown>
		| undefined;
	if (typeof sampleVideo?.uri === "string") return sampleVideo.uri;

	const generatedVideos = response?.generatedVideos as
		| Array<Record<string, unknown>>
		| undefined;
	const video = generatedVideos?.[0]?.video as
		| Record<string, unknown>
		| undefined;
	if (typeof video?.uri === "string") return video.uri;
	return undefined;
}

function parseGoogleVideoJob(
	raw: unknown,
	fallbackJobId?: string,
): CanonicalVideoProviderJob {
	const value = (raw ?? {}) as Record<string, unknown>;
	const upstreamJobId =
		typeof value.name === "string" && value.name ? value.name : fallbackJobId;
	if (!upstreamJobId) {
		throw new GatewayError({
			class: "server",
			message: "Google Veo response is missing operation name",
		});
	}
	let status: VideoStatus = "in_progress";
	let progress = 50;
	if (value.done !== true) {
		status = "queued";
		progress = 0;
	} else if (value.error) {
		status = "failed";
		progress = 100;
	} else {
		status = "completed";
		progress = 100;
	}
	const error = value.error as
		| { code?: unknown; message?: unknown; status?: unknown }
		| undefined;
	return {
		upstreamJobId,
		status,
		progress,
		...(error
			? {
					error: {
						code:
							typeof error.status === "string"
								? error.status
								: typeof error.code === "number"
									? String(error.code)
									: null,
						message:
							typeof error.message === "string"
								? error.message
								: "Video generation failed",
					},
				}
			: {}),
		providerState: {
			...value,
			...(googleVideoUri(value) ? { videoUri: googleVideoUri(value) } : {}),
		},
	};
}

const videoGeneration: VideoHandler = {
	async submit(req, ctx) {
		if (ctx.transport !== "generate_videos") {
			throw new GatewayError({
				class: "server",
				message: `Google: transport "${ctx.transport}" cannot generate videos`,
			});
		}
		const c = creds(ctx);
		const base = (c.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
		return parseGoogleVideoJob(
			await googleFetchJson(
				`${base}/models/${encodeURIComponent(ctx.upstreamModel)}:predictLongRunning`,
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						"x-goog-api-key": c.apiKey,
						...(c.headers ?? {}),
					},
					body: JSON.stringify(googleVideoBody(req, ctx)),
					...(ctx.signal ? { signal: ctx.signal } : {}),
				},
				ctx,
			),
		);
	},
	async refresh(job, ctx) {
		const c = creds(ctx);
		const base = (c.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
		return parseGoogleVideoJob(
			await googleFetchJson(
				`${base}/${job.upstreamJobId}`,
				{
					method: "GET",
					headers: {
						"x-goog-api-key": c.apiKey,
						...(c.headers ?? {}),
					},
					...(ctx.signal ? { signal: ctx.signal } : {}),
				},
				ctx,
			),
			job.upstreamJobId,
		);
	},
	async download(job, variant: VideoAssetVariant, ctx) {
		if (variant !== "video") {
			throw new GatewayError({
				class: "not_found",
				code: "video_variant_unavailable",
				message: `Google Veo transport does not provide ${variant}`,
			});
		}
		const uri = (job.providerState as { videoUri?: unknown } | null | undefined)
			?.videoUri;
		if (typeof uri !== "string" || !uri) {
			throw new GatewayError({
				class: "not_found",
				code: "video_content_unavailable",
				message:
					"Google Veo operation does not contain a downloadable video URI",
			});
		}
		const c = creds(ctx);
		let res: Response;
		try {
			res = await upstreamFetch(ctx, uri, {
				headers: { "x-goog-api-key": c.apiKey, ...(c.headers ?? {}) },
				...(ctx.signal ? { signal: ctx.signal } : {}),
			});
		} catch (err) {
			throw mapGoogleError(err);
		}
		if (!res.ok) {
			throw mapGoogleError({
				status: res.status,
				body: await parseJsonResponse(res),
			});
		}
		if (!res.body) {
			throw new GatewayError({
				class: "server",
				message: "Google Veo content response had no body",
			});
		}
		const length = res.headers.get("content-length");
		return {
			body: res.body,
			contentType: res.headers.get("content-type") ?? "video/mp4",
			...(length ? { contentLength: Number(length) } : {}),
		};
	},
	mapError(err) {
		return mapGoogleError(err);
	},
};

const embeddings: EmbeddingsHandler = {
	buildRequest(req, ctx) {
		if (ctx.transport !== "embed_content") {
			throw new GatewayError({
				class: "bad_request",
				message: `Google: transport "${ctx.transport}" cannot create embeddings`,
			});
		}
		const c = creds(ctx);
		const base = (c.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
		const { body, method } = googleEmbeddingRequestBody(req, ctx);
		return {
			method: "POST",
			url: `${base}/models/${encodeURIComponent(
				googleModelPathId(ctx.upstreamModel),
			)}:${method}`,
			headers: {
				"content-type": "application/json",
				"x-goog-api-key": c.apiKey,
				...(c.headers ?? {}),
			},
			body: JSON.stringify(body),
		};
	},
	parseResponse(raw, ctx) {
		return parseGeminiEmbeddingsResponse(raw, ctx);
	},
	mapError(err) {
		return mapGoogleError(err);
	},
};

export const googleAdapter: Adapter = {
	key: "googleaistudio",
	credentials: { required: ["apiKey"] },
	supportedCallTypes: new Set([
		"chat",
		"images.generations",
		"images.edits",
		"videos.generations",
		"embeddings",
	]),
	chat,
	imageGeneration: imageHandler,
	imageEdit: imageHandler,
	videoGeneration,
	embeddings,
	reasoningKinds: new Set<ReasoningControlKind>([
		"gemini_level",
		"gemini_budget",
	]),
	contentInputs: {
		generate_content: {
			file: { sources: ["data_url"], maxBytes: 20_000_000 },
			image: {
				sources: ["data_url"],
				mimeTypes: [
					"image/png",
					"image/jpeg",
					"image/webp",
					"image/heic",
					"image/heif",
				],
				maxBytes: 20_000_000,
			},
		},
	},
	transports: {
		chat: { supported: ["generate_content"], default: "generate_content" },
		"images.generations": {
			supported: ["generate_content"],
			default: "generate_content",
		},
		"images.edits": {
			supported: ["generate_content"],
			default: "generate_content",
		},
		"videos.generations": {
			supported: ["generate_videos"],
			default: "generate_videos",
		},
		embeddings: {
			supported: ["embed_content"],
			default: "embed_content",
		},
	},
};

export const googleProvider: ProviderModule = { adapter: googleAdapter };
