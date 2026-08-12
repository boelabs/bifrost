import { EFFORT_ORDER, type ReasoningControlKind } from "#core/reasoning.ts";
import { ADAPTER_KEY_PATTERN, ADAPTER_KEY_RULE } from "#adapters/key.ts";
import type { OperationProfiles } from "#profiles/types.ts";
import { PARAMETER_SUPPORT_MODES } from "./parameters.ts";
import type { CatalogEntry } from "./types.ts";
import { readFileSync } from "node:fs";

interface CatalogProviderInfo {
	id: string;
	adapterKey: string;
	name?: string;
	docs?: string[];
	notes?: string;
}

export interface CatalogDocument {
	$schema?: string;
	schemaVersion: 1;
	provider: CatalogProviderInfo;
	models: Record<string, CatalogEntry>;
}

export interface LoadCatalogOptions {
	adapterKey?: string;
}

const OPERATION_IDS = new Set<keyof OperationProfiles>([
	"text.generate",
	"image.generate",
	"image.edit",
	"video.generate",
	"audio.transcribe",
	"embedding.create",
	"rerank",
]);

const REASONING_KINDS = new Set<ReasoningControlKind>([
	"openai_effort",
	"openai_body",
	"anthropic_adaptive",
	"anthropic_budget",
	"gemini_level",
	"gemini_budget",
	"chat_template_flag",
	"fixed",
]);

// Deliberately minimal: only data the gateway actually consumes (operations/pricing) plus the few
// human-facing fields (deprecated/notes/needsHumanReview). Descriptive metadata (lifecycle, modalities,
// sources, aliases...) was removed on purpose - anything else here is an unknown-field failure.
const MODEL_KEYS = new Set([
	"deprecated",
	"operations",
	"pricing",
	"notes",
	"needsHumanReview",
]);

const PARAMETER_MODES = new Set<string>(PARAMETER_SUPPORT_MODES);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
	throw new Error(`Invalid JSON catalog at ${path}: ${message}`);
}

function assertString(value: unknown, path: string): asserts value is string {
	if (typeof value !== "string" || value.length === 0)
		fail(path, "must be a non-empty string");
}

function assertAdapterKey(
	value: unknown,
	path: string,
): asserts value is string {
	assertString(value, path);
	if (!ADAPTER_KEY_PATTERN.test(value)) fail(path, ADAPTER_KEY_RULE);
}

function assertNumber(value: unknown, path: string): asserts value is number {
	if (typeof value !== "number" || !Number.isFinite(value))
		fail(path, "must be a finite number");
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
	if (typeof value !== "boolean") fail(path, "must be a boolean");
}

function assertStringArray(
	value: unknown,
	path: string,
): asserts value is string[] {
	if (!Array.isArray(value)) fail(path, "must be an array");
	for (const [i, item] of value.entries()) assertString(item, `${path}[${i}]`);
}

function validatePricing(value: unknown, path: string): void {
	if (value === undefined) return;
	if (!isRecord(value)) fail(path, "must be an object");
	for (const key of [
		"inputCentsPerMTokens",
		"outputCentsPerMTokens",
		"cacheReadCentsPerMTokens",
		"cacheWriteCentsPerMTokens",
		"searchUnitCents",
	]) {
		if (value[key] !== undefined) assertNumber(value[key], `${path}.${key}`);
	}
	if (value.tiers !== undefined) {
		if (!Array.isArray(value.tiers)) fail(`${path}.tiers`, "must be an array");
		for (const [i, tier] of value.tiers.entries()) {
			if (!isRecord(tier)) fail(`${path}.tiers[${i}]`, "must be an object");
			assertNumber(
				tier.aboveInputTokens,
				`${path}.tiers[${i}].aboveInputTokens`,
			);
			for (const key of [
				"inputCentsPerMTokens",
				"outputCentsPerMTokens",
				"cacheReadCentsPerMTokens",
				"cacheWriteCentsPerMTokens",
			]) {
				if (tier[key] !== undefined)
					assertNumber(tier[key], `${path}.tiers[${i}].${key}`);
			}
		}
	}
}

function validateCapabilities(value: unknown, path: string): void {
	if (value === undefined) return;
	if (!isRecord(value)) fail(path, "must be an object");
	for (const key of ["tools", "vision", "reasoning", "structuredOutputs"]) {
		if (value[key] !== undefined) assertBoolean(value[key], `${path}.${key}`);
	}
}

function validateReasoning(value: unknown, path: string): void {
	if (value === undefined) return;
	if (!isRecord(value)) fail(path, "must be an object");
	assertString(value.kind, `${path}.kind`);
	if (!REASONING_KINDS.has(value.kind as ReasoningControlKind)) {
		fail(`${path}.kind`, `unknown kind "${value.kind}"`);
	}
	assertStringArray(value.levels, `${path}.levels`);
	for (const level of value.levels) {
		if (!(EFFORT_ORDER as readonly string[]).includes(level))
			fail(`${path}.levels`, `unknown effort "${level}"`);
	}
	if (value.budgets !== undefined) {
		if (!isRecord(value.budgets)) fail(`${path}.budgets`, "must be an object");
		for (const [level, tokens] of Object.entries(value.budgets)) {
			if (!(EFFORT_ORDER as readonly string[]).includes(level))
				fail(`${path}.budgets`, `unknown effort "${level}"`);
			assertNumber(tokens, `${path}.budgets.${level}`);
		}
	}
	if (value.upstreamEffortMap !== undefined) {
		if (!isRecord(value.upstreamEffortMap))
			fail(`${path}.upstreamEffortMap`, "must be an object");
		for (const [level, upstream] of Object.entries(value.upstreamEffortMap)) {
			if (!(EFFORT_ORDER as readonly string[]).includes(level)) {
				fail(`${path}.upstreamEffortMap`, `unknown effort "${level}"`);
			}
			assertString(upstream, `${path}.upstreamEffortMap.${level}`);
		}
	}
	if (value.effortField !== undefined)
		assertString(value.effortField, `${path}.effortField`);
	if (value.bodyField !== undefined) {
		if (!isRecord(value.bodyField))
			fail(`${path}.bodyField`, "must be an object");
		assertString(value.bodyField.param, `${path}.bodyField.param`);
	}
	if (value.chatTemplateFlag !== undefined) {
		if (!isRecord(value.chatTemplateFlag))
			fail(`${path}.chatTemplateFlag`, "must be an object");
		assertString(
			value.chatTemplateFlag.param,
			`${path}.chatTemplateFlag.param`,
		);
	}
	if (value.kind === "openai_body" && value.bodyField === undefined) {
		fail(`${path}.bodyField`, 'is required when kind is "openai_body"');
	}
	if (value.kind !== "openai_body" && value.bodyField !== undefined) {
		fail(`${path}.bodyField`, 'is only allowed when kind is "openai_body"');
	}
	if (value.kind !== "openai_body" && value.effortField !== undefined) {
		fail(`${path}.effortField`, 'is only allowed when kind is "openai_body"');
	}
	if (
		value.kind === "chat_template_flag" &&
		value.chatTemplateFlag === undefined
	) {
		fail(
			`${path}.chatTemplateFlag`,
			'is required when kind is "chat_template_flag"',
		);
	}
	if (
		value.kind !== "chat_template_flag" &&
		value.chatTemplateFlag !== undefined
	) {
		fail(
			`${path}.chatTemplateFlag`,
			'is only allowed when kind is "chat_template_flag"',
		);
	}
	if (
		(value.kind === "anthropic_budget" || value.kind === "gemini_budget") &&
		value.levels.includes("max") &&
		(!isRecord(value.budgets) || value.budgets.max === undefined)
	) {
		fail(
			`${path}.budgets.max`,
			'is required when a budget-based reasoning spec declares "max"',
		);
	}
}

function validateParameterSupport(value: unknown, path: string): void {
	if (typeof value === "boolean") return;
	if (!isRecord(value)) fail(path, "must be a boolean or object");
	if (value.mode !== undefined) {
		assertString(value.mode, `${path}.mode`);
		if (!PARAMETER_MODES.has(value.mode))
			fail(`${path}.mode`, `unknown mode "${value.mode}"`);
	}
	if (value.min !== undefined) assertNumber(value.min, `${path}.min`);
	if (value.max !== undefined) assertNumber(value.max, `${path}.max`);
	if (value.values !== undefined) {
		if (!Array.isArray(value.values))
			fail(`${path}.values`, "must be an array");
		for (const [i, item] of value.values.entries()) {
			if (
				typeof item !== "string" &&
				typeof item !== "number" &&
				typeof item !== "boolean"
			) {
				fail(`${path}.values[${i}]`, "must be a string, number, or boolean");
			}
		}
	}
	if (value.upstreamField !== undefined)
		assertString(value.upstreamField, `${path}.upstreamField`);
	if (value.notes !== undefined) assertString(value.notes, `${path}.notes`);
}

function validateParameters(value: unknown, path: string): void {
	if (value === undefined) return;
	if (!isRecord(value)) fail(path, "must be an object");
	for (const [name, support] of Object.entries(value)) {
		assertString(name, `${path} key`);
		validateParameterSupport(support, `${path}.${name}`);
	}
}

function validateOperations(value: unknown, path: string): void {
	if (!isRecord(value)) fail(path, "must be an object");
	for (const [operation, profile] of Object.entries(value)) {
		if (!OPERATION_IDS.has(operation as keyof OperationProfiles))
			fail(path, `unknown operation "${operation}"`);
		if (!isRecord(profile)) fail(`${path}.${operation}`, "must be an object");
		if (operation === "text.generate") {
			validateCapabilities(
				profile.capabilities,
				`${path}.${operation}.capabilities`,
			);
			if (profile.maxInputTokens !== undefined)
				assertNumber(
					profile.maxInputTokens,
					`${path}.${operation}.maxInputTokens`,
				);
			if (profile.maxOutputTokens !== undefined)
				assertNumber(
					profile.maxOutputTokens,
					`${path}.${operation}.maxOutputTokens`,
				);
			validateReasoning(profile.reasoning, `${path}.${operation}.reasoning`);
			validateParameters(profile.parameters, `${path}.${operation}.parameters`);
		} else if (operation === "embedding.create") {
			for (const key of [
				"dimensions",
				"minDimensions",
				"maxDimensions",
				"maxInputs",
				"maxInputTokens",
				"maxTotalTokens",
				"maxInputBytes",
				"maxTotalInputBytes",
			]) {
				if (profile[key] !== undefined)
					assertNumber(profile[key], `${path}.${operation}.${key}`);
			}
			for (const key of ["supportsDimensions", "supportsTokenInput"]) {
				if (profile[key] !== undefined)
					assertBoolean(profile[key], `${path}.${operation}.${key}`);
			}
			if (profile.encodingFormats !== undefined) {
				assertStringArray(
					profile.encodingFormats,
					`${path}.${operation}.encodingFormats`,
				);
				for (const format of profile.encodingFormats) {
					if (format !== "float" && format !== "base64")
						fail(
							`${path}.${operation}.encodingFormats`,
							`unknown format "${format}"`,
						);
				}
			}
		} else if (operation === "rerank") {
			assertStringArray(
				profile.documentModalities,
				`${path}.${operation}.documentModalities`,
			);
			for (const modality of profile.documentModalities as string[]) {
				if (modality !== "text" && modality !== "image")
					fail(
						`${path}.${operation}.documentModalities`,
						`unknown modality "${modality}"`,
					);
			}
			if (profile.imageSources !== undefined) {
				assertStringArray(
					profile.imageSources,
					`${path}.${operation}.imageSources`,
				);
				for (const source of profile.imageSources) {
					if (source !== "url" && source !== "data_url")
						fail(
							`${path}.${operation}.imageSources`,
							`unknown source "${source}"`,
						);
				}
			}
			for (const key of [
				"maxDocuments",
				"maxQueryBytes",
				"maxDocumentBytes",
				"maxTotalDocumentBytes",
				"maxTokensPerDocument",
				"maxTotalTokens",
				"documentsPerSearchUnit",
			]) {
				if (profile[key] !== undefined)
					assertNumber(profile[key], `${path}.${operation}.${key}`);
			}
		} else if (operation === "video.generate") {
			for (const key of [
				"maxPromptChars",
				"maxReferenceBytes",
				"maxInputReferences",
				"pollIntervalSeconds",
			]) {
				if (profile[key] !== undefined)
					assertNumber(profile[key], `${path}.${operation}.${key}`);
			}
			for (const key of [
				"supportsImageUrl",
				"supportsAudioUrl",
				"supportsVideoUrl",
				"supportsFileId",
				"supportsFrameImages",
				"supportsSeed",
				"supportsGenerateAudio",
				"requiresDataUrlImageReference",
			]) {
				if (profile[key] !== undefined)
					assertBoolean(profile[key], `${path}.${operation}.${key}`);
			}
			for (const key of ["durations", "qualities", "contentVariants"]) {
				if (profile[key] !== undefined)
					assertStringArray(profile[key], `${path}.${operation}.${key}`);
			}
			if (profile.sizes !== undefined) {
				if (!isRecord(profile.sizes))
					fail(`${path}.${operation}.sizes`, "must be an object");
				for (const [size, mapping] of Object.entries(profile.sizes)) {
					assertString(size, `${path}.${operation}.sizes key`);
					if (!isRecord(mapping)) {
						fail(`${path}.${operation}.sizes.${size}`, "must be an object");
					}
					for (const key of ["size", "aspectRatio", "resolution"]) {
						if (mapping[key] !== undefined) {
							assertString(
								mapping[key],
								`${path}.${operation}.sizes.${size}.${key}`,
							);
						}
					}
				}
			}
		}
	}
}

function validateModelMetadata(
	model: Record<string, unknown>,
	path: string,
): void {
	for (const key of Object.keys(model)) {
		if (!MODEL_KEYS.has(key)) fail(path, `unknown field "${key}"`);
	}
	if (model.notes !== undefined) assertString(model.notes, `${path}.notes`);
	if (model.needsHumanReview !== undefined)
		assertStringArray(model.needsHumanReview, `${path}.needsHumanReview`);
}

function validateDocument(
	value: unknown,
	path: string,
	opts: LoadCatalogOptions,
): asserts value is CatalogDocument {
	if (!isRecord(value)) fail(path, "the root must be an object");
	if (value.$schema !== undefined)
		assertString(value.$schema, `${path}.$schema`);
	if (value.schemaVersion !== 1) fail(`${path}.schemaVersion`, "must be 1");
	if (!isRecord(value.provider)) fail(`${path}.provider`, "must be an object");
	assertString(value.provider.id, `${path}.provider.id`);
	assertAdapterKey(value.provider.adapterKey, `${path}.provider.adapterKey`);
	if (
		opts.adapterKey !== undefined &&
		value.provider.adapterKey !== opts.adapterKey
	) {
		fail(
			`${path}.provider.adapterKey`,
			`expected "${opts.adapterKey}", received "${value.provider.adapterKey}"`,
		);
	}
	if (value.provider.name !== undefined)
		assertString(value.provider.name, `${path}.provider.name`);
	if (value.provider.docs !== undefined)
		assertStringArray(value.provider.docs, `${path}.provider.docs`);
	if (!isRecord(value.models))
		fail(`${path}.models`, "must be an object keyed by model id");
	for (const [modelId, model] of Object.entries(value.models)) {
		if (!isRecord(model))
			fail(`${path}.models.${modelId}`, "must be an object");
		validateModelMetadata(model, `${path}.models.${modelId}`);
		validateOperations(
			model.operations,
			`${path}.models.${modelId}.operations`,
		);
		validatePricing(model.pricing, `${path}.models.${modelId}.pricing`);
		if (model.deprecated !== undefined)
			assertBoolean(model.deprecated, `${path}.models.${modelId}.deprecated`);
	}
}

export function loadCatalogDocument(
	url: URL,
	opts: LoadCatalogOptions = {},
): CatalogDocument {
	const path = url.pathname;
	const parsed = JSON.parse(readFileSync(url, "utf8")) as unknown;
	validateDocument(parsed, path, opts);
	return parsed;
}

export function loadProviderCatalog(
	url: URL,
	opts: LoadCatalogOptions = {},
): Record<string, CatalogEntry> {
	return loadCatalogDocument(url, opts).models;
}
