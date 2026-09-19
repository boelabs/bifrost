import type { VercelModelPricing, VercelModel } from "./sources/vercel.ts";
import { EFFORT_ORDER, isReasoningEffort } from "#core/reasoning.ts";
import type { ParameterSupportMap } from "#catalog/parameters.ts";
import { candidateAdapterMappings } from "./providerIdentity.ts";
import { dollarsPerTokenToCentsPerMillion } from "./pricing.ts";
import type { CatalogDocument } from "#catalog/jsonCatalog.ts";
import type { ReasoningEffort } from "#core/reasoning.ts";
import type { CatalogEntry } from "#catalog/types.ts";

const TEXT_MODALITIES = new Set([
	"text",
	"image",
	"audio",
	"video",
	"pdf",
	"file",
	"embedding",
	"moderation",
]);

type Pricing = NonNullable<CatalogEntry["pricing"]>;
type PricingTier = NonNullable<Pricing["tiers"]>[number];
type PricingField = Exclude<
	keyof Pricing,
	"tiers" | "cacheWriteCentsPerMTokensByTtl"
>;
type TierPricingField = Exclude<PricingField, "searchUnitCents">;
type TierField = Exclude<keyof VercelModelPricing, "image">;

interface TierDefinition {
	source: TierField;
	target: TierPricingField;
}

const TIER_DEFINITIONS: readonly TierDefinition[] = [
	{ source: "input_tiers", target: "inputCentsPerMTokens" },
	{ source: "output_tiers", target: "outputCentsPerMTokens" },
	{ source: "input_cache_read_tiers", target: "cacheReadCentsPerMTokens" },
	{ source: "input_cache_write_tiers", target: "cacheWriteCentsPerMTokens" },
];

const SUPPORTED_TYPES = new Set([
	"language",
	"embedding",
	"image",
	"reranking",
]);

/** Reviewed USD-cent prices per Cohere search (up to 100 documents). */
const RERANK_SEARCH_UNIT_CENTS: Readonly<Record<string, number>> = {
	"cohere/rerank-v3.5": 0.1,
	"cohere/rerank-v4-fast": 0.2,
	"cohere/rerank-v4-pro": 0.25,
};

export interface VercelCatalogReport {
	sourceModels: number;
	includedModels: number;
	includedByType: Record<string, number>;
	skippedByType: Record<string, number>;
	skippedModels: Array<{ id: string; type: string; reason: string }>;
	unrepresentedPricing: Array<{ id: string; field: string }>;
	reasoningWithoutEffortLevels: string[];
	unrecognizedReasoningEfforts: Array<{ id: string; values: string[] }>;
	ambiguousZeroPricing: string[];
	multimodalRerankWithheld: string[];
	orphanedRerankPricingOverrides: string[];
	paidRerankModelsWithoutCost: string[];
	inheritedImageProfiles: Array<{
		id: string;
		operation: string;
		from: string;
		fields: string[];
	}>;
	imageProfilesWithoutReference: Array<{ id: string; operation: string }>;
}

export interface VercelCatalogGeneration {
	document: CatalogDocument;
	report: VercelCatalogReport;
}

function positiveInteger(value: number | undefined): number | undefined {
	return value !== undefined && Number.isInteger(value) && value > 0
		? value
		: undefined;
}

function sortedModalities(
	values: string[] | undefined,
): Array<
	| "text"
	| "image"
	| "audio"
	| "video"
	| "pdf"
	| "file"
	| "embedding"
	| "moderation"
> {
	return [...new Set(values ?? [])]
		.filter((value) => TEXT_MODALITIES.has(value))
		.sort() as Array<
		| "text"
		| "image"
		| "audio"
		| "video"
		| "pdf"
		| "file"
		| "embedding"
		| "moderation"
	>;
}

function parametersFor(model: VercelModel): ParameterSupportMap | undefined {
	const names = new Set(model.supported_parameters ?? []);
	if (model.reasoning_options?.length) {
		names.add("reasoning_effort");
	}
	const entries = [...names]
		.filter((name) => name.length > 0)
		.sort()
		.map((name) => [name, true] as const);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function reasoningFor(model: VercelModel):
	| {
			kind: "openai_effort";
			levels: ReasoningEffort[];
	  }
	| {
			kind: "fixed";
			levels: ["high"];
	  }
	| undefined {
	const options = model.reasoning_options ?? [];
	const canToggle = options.some((option) => option.type === "toggle");
	const effortLevels = new Set<ReasoningEffort>();
	for (const option of options) {
		if (option.type !== "effort") {
			continue;
		}
		for (const value of option.values ?? []) {
			if (isReasoningEffort(value)) {
				effortLevels.add(value);
			}
		}
	}
	if (canToggle) {
		effortLevels.add("none");
	}
	if (effortLevels.size > 0) {
		if (canToggle && effortLevels.size === 1) {
			effortLevels.add("high");
		}
		return {
			kind: "openai_effort",
			levels: EFFORT_ORDER.filter((effort) => effortLevels.has(effort)),
		};
	}
	if (
		options.some((option) => option.type === "budget_tokens") ||
		model.tags?.includes("reasoning")
	) {
		// A budget range proves the model reasons, but it does not define portable effort cutoffs.
		// `fixed` keeps the behavior truthful without inventing a budget ladder.
		return { kind: "fixed", levels: ["high"] };
	}
	return undefined;
}

function tierCost(
	pricing: VercelModelPricing,
	source: TierField,
	threshold: number,
): number | undefined {
	const tiers = pricing[source];
	if (!Array.isArray(tiers)) {
		return undefined;
	}
	const [active] = tiers
		.filter(
			(tier) =>
				tier.min <= threshold &&
				(tier.max === undefined || threshold < tier.max),
		)
		.sort((a, b) => b.min - a.min);
	return dollarsPerTokenToCentsPerMillion(active?.cost);
}

export function pricingForVercelModel(
	raw: VercelModelPricing | undefined,
): Pricing | undefined {
	if (!raw) {
		return undefined;
	}
	const pricing: Pricing = {};
	const input =
		dollarsPerTokenToCentsPerMillion(raw.input) ??
		tierCost(raw, "input_tiers", 0);
	const output =
		dollarsPerTokenToCentsPerMillion(raw.output) ??
		tierCost(raw, "output_tiers", 0);
	const cacheRead =
		dollarsPerTokenToCentsPerMillion(raw.input_cache_read) ??
		tierCost(raw, "input_cache_read_tiers", 0);
	const cacheWrite =
		dollarsPerTokenToCentsPerMillion(raw.input_cache_write) ??
		tierCost(raw, "input_cache_write_tiers", 0);
	if (input !== undefined) {
		pricing.inputCentsPerMTokens = input;
	}
	if (output !== undefined) {
		pricing.outputCentsPerMTokens = output;
	}
	if (cacheRead !== undefined) {
		pricing.cacheReadCentsPerMTokens = cacheRead;
	}
	if (cacheWrite !== undefined) {
		pricing.cacheWriteCentsPerMTokens = cacheWrite;
	}

	const thresholds = new Set<number>();
	for (const { source } of TIER_DEFINITIONS) {
		const tiers = raw[source];
		if (!Array.isArray(tiers)) {
			continue;
		}
		for (const tier of tiers) {
			if (Number.isInteger(tier.min) && tier.min > 0) {
				thresholds.add(tier.min);
			}
		}
	}
	const tiers: PricingTier[] = [];
	for (const threshold of [...thresholds].sort((a, b) => a - b)) {
		const tier: PricingTier = { aboveInputTokens: threshold };
		for (const { source, target } of TIER_DEFINITIONS) {
			const cost = tierCost(raw, source, threshold);
			if (cost !== undefined) {
				tier[target] = cost;
			}
		}
		if (Object.keys(tier).length > 1) {
			tiers.push(tier);
		}
	}
	if (tiers.length > 0) {
		pricing.tiers = tiers;
	}
	return Object.keys(pricing).length > 0 ? pricing : undefined;
}

/** The catalog entry each Vercel model type produces. */
function catalogEntryFor(
	type: string,
	model: VercelModel,
	report: VercelCatalogReport,
	references: ReferenceCatalogs | undefined,
): CatalogEntry {
	if (type === "language") {
		return languageEntry(model, report, references);
	}
	if (type === "embedding") {
		return embeddingEntry(model);
	}
	return type === "image"
		? imageEntry(model, report, references)
		: rerankEntry(model, report);
}

function languageEntry(
	model: VercelModel,
	report: VercelCatalogReport,
	references: ReferenceCatalogs | undefined,
): CatalogEntry {
	const tags = new Set(model.tags ?? []);
	const reasoning = reasoningFor(model);
	const unrecognizedEfforts = [
		...new Set(
			(model.reasoning_options ?? []).flatMap((option) =>
				option.type === "effort"
					? (option.values ?? []).filter((value) => !isReasoningEffort(value))
					: [],
			),
		),
	].sort();
	if (unrecognizedEfforts.length > 0) {
		report.unrecognizedReasoningEfforts.push({
			id: model.id,
			values: unrecognizedEfforts,
		});
	}
	if (reasoning?.kind === "fixed") {
		report.reasoningWithoutEffortLevels.push(model.id);
	}
	const input = sortedModalities(model.modalities?.input);
	const output = sortedModalities(model.modalities?.output);
	const parameters = parametersFor(model);
	const maxInputTokens = positiveInteger(model.context_window);
	const maxOutputTokens = positiveInteger(model.max_tokens);
	const producesImages = output.includes("image");
	const operation = {
		capabilities: {
			tools:
				tags.has("tool-use") ||
				model.supported_parameters?.includes("tools") === true,
			vision: tags.has("vision") || input.includes("image"),
			reasoning: reasoning !== undefined,
			structuredOutputs:
				tags.has("structured-outputs") ||
				model.supported_parameters?.some((parameter) =>
					["response_format", "structured_outputs"].includes(parameter),
				) === true,
		},
		...(maxInputTokens === undefined ? {} : { maxInputTokens }),
		...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
		...(input.length > 0 || output.length > 0
			? {
					modalities: {
						...(input.length > 0 ? { input } : {}),
						...(output.length > 0 ? { output } : {}),
					},
				}
			: {}),
		contracts: ["chat.completions", "responses"] as Array<
			"chat.completions" | "responses"
		>,
		...(parameters ? { parameters } : {}),
		...(reasoning ? { reasoning } : {}),
	};
	const pricing = pricingForVercelModel(model.pricing);
	return {
		operations: {
			"text.generate": operation,
			...(producesImages
				? {
						"image.generate": imageOperation(
							"image.generate",
							model,
							report,
							references,
						),
						...(input.includes("image")
							? {
									"image.edit": imageOperation(
										"image.edit",
										model,
										report,
										references,
									),
								}
							: {}),
					}
				: {}),
		},
		...(pricing ? { pricing } : {}),
	};
}

function embeddingEntry(model: VercelModel): CatalogEntry {
	const maxInputTokens = positiveInteger(model.context_window);
	const supportsDimensions =
		model.supported_parameters?.includes("dimensions") === true;
	const pricing = pricingForVercelModel(model.pricing);
	return {
		operations: {
			"embedding.create": {
				encodingFormats: ["float", "base64"],
				...(maxInputTokens === undefined ? {} : { maxInputTokens }),
				...(supportsDimensions ? { supportsDimensions: true } : {}),
				supportsTokenInput: false,
			},
		},
		...(pricing ? { pricing } : {}),
	};
}

type ImageOperation = NonNullable<CatalogEntry["operations"]["image.generate"]>;

/**
 * The request-validation half of an image profile: what a caller may ask for. Vercel's `/v1/models`
 * describes none of it, so on its own this adapter rejects every `quality`, every explicit `size`,
 * and validates no input-image limits at all for models it merely proxies. When the same model is
 * also served by a first-party adapter, that adapter's reviewed profile is the best statement we
 * have of what the model accepts, so it is carried over.
 *
 * The gateway-behavior half is deliberately not inherited: `qualityMappings`, `autoSize` and the
 * `native*` flags describe how one specific transport talks to the provider, and Vercel's is
 * OpenAI-shaped (`quality` and `size` go up verbatim - see contracts/openai/imagesTransport.ts),
 * not Gemini's native image config.
 */
const INHERITED_IMAGE_FIELDS = [
	"maxPromptChars",
	"maxInputImages",
	"maxImageBytes",
	"maxTotalInputBytes",
	"maxN",
	"supportsMask",
	"supportsInputFidelity",
	"supportsModeration",
	"supportsStyle",
	"supportsTransparentBackground",
	"qualities",
	"sizes",
	"arbitrarySize",
] as const satisfies ReadonlyArray<keyof ImageOperation>;

/** Reviewed first-party profiles, keyed by adapter, that a proxied model may inherit from. */
export type ReferenceCatalogs = Readonly<
	Record<string, Readonly<Record<string, CatalogEntry>>>
>;

/**
 * The first-party entry for a Vercel model id, e.g. `google/gemini-3.1-flash-image` ->
 * googleaistudio's `gemini-3.1-flash-image`. Ambiguous prefixes (`openai/` is both openai and
 * azureopenai) resolve to the rule that does not need an endpoint call to disambiguate, because
 * Vercel's model list carries no endpoint data.
 */
function referenceEntryFor(
	modelId: string,
	references: ReferenceCatalogs | undefined,
): { adapterKey: string; entry: CatalogEntry } | undefined {
	if (!references) {
		return undefined;
	}
	const candidates = candidateAdapterMappings(modelId).sort(
		(a, b) =>
			Number(a.requiresEndpointMatch ?? false) -
			Number(b.requiresEndpointMatch ?? false),
	);
	for (const candidate of candidates) {
		if (candidate.adapterKey === "vercel") {
			continue; // never inherit from ourselves
		}
		const entry = references[candidate.adapterKey]?.[candidate.upstreamModel];
		if (entry) {
			return { adapterKey: candidate.adapterKey, entry };
		}
	}
	return undefined;
}

function imageOperation(
	operation: "image.generate" | "image.edit",
	model: VercelModel,
	report: VercelCatalogReport,
	references: ReferenceCatalogs | undefined,
): ImageOperation {
	const base: ImageOperation = {
		// The REST adapter always requests b64_json and can transcode these client formats.
		outputFormats: ["png", "jpeg", "webp"],
		responseFormats: ["b64_json"],
		autoSize: {},
		nativeOutputFormat: false,
		nativeOutputCompression: false,
	};
	const reference = referenceEntryFor(model.id, references);
	const source = reference?.entry.operations[operation];
	if (!(reference && source)) {
		report.imageProfilesWithoutReference.push({ id: model.id, operation });
		return base;
	}
	const inherited: string[] = [];
	for (const field of INHERITED_IMAGE_FIELDS) {
		const value = source[field];
		if (value === undefined) {
			continue;
		}
		Object.assign(base, { [field]: structuredClone(value) });
		inherited.push(field);
	}
	if (inherited.length === 0) {
		report.imageProfilesWithoutReference.push({ id: model.id, operation });
		return base;
	}
	report.inheritedImageProfiles.push({
		id: model.id,
		operation,
		from: `${reference.adapterKey}/${
			candidateAdapterMappings(model.id).find(
				(candidate) => candidate.adapterKey === reference.adapterKey,
			)?.upstreamModel ?? model.id
		}`,
		fields: inherited,
	});
	return base;
}

function imageEntry(
	model: VercelModel,
	report: VercelCatalogReport,
	references: ReferenceCatalogs | undefined,
): CatalogEntry {
	if (model.pricing?.image !== undefined) {
		report.unrepresentedPricing.push({ id: model.id, field: "pricing.image" });
	}
	const pricing = pricingForVercelModel(model.pricing);
	return {
		operations: {
			"image.generate": imageOperation(
				"image.generate",
				model,
				report,
				references,
			),
		},
		...(pricing ? { pricing } : {}),
	};
}

function hasOnlyZeroRates(pricing: Pricing | undefined): boolean {
	if (!pricing) {
		return false;
	}
	const values = Object.entries(pricing)
		.filter(([key]) => key !== "tiers")
		.map(([, value]) => value);
	return values.length > 0 && values.every((value) => value === 0);
}

function rerankEntry(
	model: VercelModel,
	report: VercelCatalogReport,
): CatalogEntry {
	const maxTokensPerDocument = positiveInteger(model.context_window);
	const sourcePricing = pricingForVercelModel(model.pricing);
	const pricing = hasOnlyZeroRates(sourcePricing) ? undefined : sourcePricing;
	if (hasOnlyZeroRates(sourcePricing)) {
		report.ambiguousZeroPricing.push(model.id);
	}
	const searchUnitCents = RERANK_SEARCH_UNIT_CENTS[model.id];
	const effectivePricing =
		searchUnitCents === undefined ? pricing : { ...pricing, searchUnitCents };
	if (model.modalities?.input?.includes("image")) {
		report.multimodalRerankWithheld.push(model.id);
	}
	if (!(effectivePricing || model.id.endsWith(":free"))) {
		report.paidRerankModelsWithoutCost.push(model.id);
	}
	return {
		operations: {
			rerank: {
				documentModalities: ["text"],
				maxDocuments: 1000,
				...(maxTokensPerDocument === undefined ? {} : { maxTokensPerDocument }),
				...(model.id.startsWith("cohere/")
					? { documentsPerSearchUnit: 100 }
					: {}),
			},
		},
		...(effectivePricing ? { pricing: effectivePricing } : {}),
	};
}

function increment(record: Record<string, number>, key: string): void {
	record[key] = (record[key] ?? 0) + 1;
}

export function buildVercelCatalog(
	sourceModels: readonly VercelModel[],
	references?: ReferenceCatalogs,
): VercelCatalogGeneration {
	const report: VercelCatalogReport = {
		sourceModels: sourceModels.length,
		includedModels: 0,
		includedByType: {},
		skippedByType: {},
		skippedModels: [],
		unrepresentedPricing: [],
		reasoningWithoutEffortLevels: [],
		unrecognizedReasoningEfforts: [],
		ambiguousZeroPricing: [],
		multimodalRerankWithheld: [],
		orphanedRerankPricingOverrides: [],
		paidRerankModelsWithoutCost: [],
		inheritedImageProfiles: [],
		imageProfilesWithoutReference: [],
	};
	const models: Record<string, CatalogEntry> = {};
	const seen = new Set<string>();
	for (const model of [...sourceModels].sort((a, b) =>
		a.id.localeCompare(b.id),
	)) {
		if (!model.id?.includes("/")) {
			throw new Error(`Invalid Vercel model id: ${JSON.stringify(model.id)}`);
		}
		if (seen.has(model.id)) {
			throw new Error(`Duplicate Vercel model id: ${model.id}`);
		}
		seen.add(model.id);
		const type = model.type ?? "unknown";
		if (!SUPPORTED_TYPES.has(type)) {
			increment(report.skippedByType, type);
			report.skippedModels.push({
				id: model.id,
				type,
				reason: `The Vercel adapter does not implement ${type} operations`,
			});
			continue;
		}
		const entry = catalogEntryFor(type, model, report, references);
		models[model.id] = entry;
		increment(report.includedByType, type);
		report.includedModels += 1;
	}
	for (const id of Object.keys(RERANK_SEARCH_UNIT_CENTS)) {
		if (!seen.has(id)) {
			report.orphanedRerankPricingOverrides.push(id);
		}
	}
	return {
		document: {
			$schema: "../../../schemas/model-catalog.schema.json",
			schemaVersion: 1,
			provider: {
				id: "vercel",
				adapterKey: "vercel",
				name: "Vercel AI Gateway",
				docs: [
					"https://vercel.com/docs/ai-gateway/sdks-and-apis",
					"https://vercel.com/docs/ai-gateway/models-and-providers",
				],
			},
			models,
		},
		report,
	};
}
