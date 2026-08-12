import type { CatalogEntry } from "#catalog/types.ts";
import type { MatchedCandidate } from "./match.ts";
import type { EnrichmentModel } from "./types.ts";

const PRICING_TOLERANCE = 0.03; // 3% relative - dollar-string rounding noise between sources
const EXACT_TOLERANCE = 0; // context/token limits should agree exactly when sources agree at all

type NumericSourceKey = "vercel-ai-gateway" | "openrouter" | "models-dev";

interface NumericConflict {
	field: string;
	values: Partial<Record<NumericSourceKey, number>>;
}

interface ResolvedNumeric {
	value: number | undefined;
	conflict: NumericConflict | undefined;
}

function within(a: number, b: number, relativeTolerance: number): boolean {
	if (relativeTolerance === 0) return a === b;
	const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
	return Math.abs(a - b) / scale <= relativeTolerance;
}

/**
 * 2-of-3 tolerance resolution: with 0 or 1 sources reporting a value, use whatever's there (or nothing).
 * With 2+, only apply a value when at least two sources agree within tolerance - a lone outlier can't
 * silently override, and a genuine 3-way disagreement is surfaced as a conflict instead of guessed.
 * Vercel's own figure is preferred whenever it's part of an agreeing pair, per the confirmed priority.
 */
function resolveNumeric(
	field: string,
	values: Partial<Record<NumericSourceKey, number>>,
	relativeTolerance: number,
): ResolvedNumeric {
	const entries = Object.entries(values) as Array<[NumericSourceKey, number]>;
	if (entries.length === 0) return { value: undefined, conflict: undefined };
	if (entries.length === 1)
		return { value: entries[0]![1], conflict: undefined };

	const vercel = values["vercel-ai-gateway"];
	const openrouter = values.openrouter;
	const modelsDev = values["models-dev"];

	if (
		vercel !== undefined &&
		openrouter !== undefined &&
		within(vercel, openrouter, relativeTolerance)
	) {
		return { value: vercel, conflict: undefined };
	}
	if (
		vercel !== undefined &&
		modelsDev !== undefined &&
		within(vercel, modelsDev, relativeTolerance)
	) {
		return { value: vercel, conflict: undefined };
	}
	if (
		openrouter !== undefined &&
		modelsDev !== undefined &&
		within(openrouter, modelsDev, relativeTolerance)
	) {
		return { value: openrouter, conflict: undefined };
	}
	return { value: undefined, conflict: { field, values } };
}

function pricingValues(
	candidate: MatchedCandidate,
	modelsDevMatch: EnrichmentModel | undefined,
	field:
		| "inputCentsPerMTokens"
		| "outputCentsPerMTokens"
		| "cacheReadCentsPerMTokens"
		| "cacheWriteCentsPerMTokens",
): Partial<Record<NumericSourceKey, number>> {
	const values: Partial<Record<NumericSourceKey, number>> = {};
	for (const source of ["vercel-ai-gateway", "openrouter"] as const) {
		const bySource = candidate.bySource[source];
		const value =
			bySource?.endpoint?.pricing?.[field] ?? bySource?.model.pricing?.[field];
		if (value !== undefined) values[source] = value;
	}
	const modelsDevValue = modelsDevMatch?.pricing?.[field];
	if (modelsDevValue !== undefined) values["models-dev"] = modelsDevValue;
	return values;
}

function contextValues(
	candidate: MatchedCandidate,
	modelsDevMatch: EnrichmentModel | undefined,
): Partial<Record<NumericSourceKey, number>> {
	const values: Partial<Record<NumericSourceKey, number>> = {};
	for (const source of ["vercel-ai-gateway", "openrouter"] as const) {
		const bySource = candidate.bySource[source];
		const value =
			bySource?.endpoint?.contextLength ?? bySource?.model.contextWindow;
		if (value !== undefined) values[source] = value;
	}
	if (modelsDevMatch?.contextWindow !== undefined) {
		values["models-dev"] = modelsDevMatch.contextWindow;
	}
	return values;
}

function maxTokensValues(
	candidate: MatchedCandidate,
	modelsDevMatch: EnrichmentModel | undefined,
): Partial<Record<NumericSourceKey, number>> {
	const values: Partial<Record<NumericSourceKey, number>> = {};
	for (const source of ["vercel-ai-gateway", "openrouter"] as const) {
		const bySource = candidate.bySource[source];
		const value =
			bySource?.endpoint?.maxCompletionTokens ?? bySource?.model.maxTokens;
		if (value !== undefined) values[source] = value;
	}
	if (modelsDevMatch?.maxOutputTokens !== undefined) {
		values["models-dev"] = modelsDevMatch.maxOutputTokens;
	}
	return values;
}

function supportedParameterNames(candidate: MatchedCandidate): Set<string> {
	const names = new Set<string>();
	for (const source of ["vercel-ai-gateway", "openrouter"] as const) {
		const bySource = candidate.bySource[source];
		for (const name of bySource?.endpoint?.supportedParameters ??
			bySource?.model.supportedParameters ??
			[])
			names.add(name);
	}
	return names;
}

function anySourceModel(candidate: MatchedCandidate) {
	return (
		candidate.bySource["vercel-ai-gateway"]?.model ??
		candidate.bySource.openrouter?.model
	);
}

/**
 * Creates `operations["text.generate"]`/`operations["image.generate"]` on a brand-new entry when the
 * candidate's modalities call for them and they don't already exist - lets the CLI hand this function a
 * near-empty stub (`{ operations: {}, sources: [] }`) for a confirmed-but-uncataloged candidate and get a
 * fully populated entry back through the exact same path an existing entry's refresh takes, instead of a
 * second, parallel "build a new entry" implementation.
 *
 * Only ever fires for a genuinely empty `operations` (a real stub): an entry that already declares SOME
 * operation (e.g. `embedding.create` only, or `image.generate`/`image.edit` only) has already been
 * deliberately scoped, and must never get a `text.generate` "topped up" onto it just because the matched
 * source's modality data happened to be sparse/empty - that's exactly how a pure embedding or image model
 * would silently start looking chat-capable (confirmed the hard way: this bug shipped once already,
 * adding a phantom text.generate to every embedding/image/audio-transcription model whose source had no
 * output_modalities data).
 */
function ensureOperations(
	entry: CatalogEntry,
	candidate: MatchedCandidate,
): void {
	if (Object.keys(entry.operations).length > 0) return;
	const model = anySourceModel(candidate);
	const outputModalities = model?.outputModalities ?? [];
	if (
		!entry.operations["text.generate"] &&
		(outputModalities.length === 0 || outputModalities.includes("text"))
	) {
		entry.operations["text.generate"] = {};
	}
	if (
		!entry.operations["image.generate"] &&
		outputModalities.includes("image")
	) {
		entry.operations["image.generate"] = { responseFormats: ["b64_json"] };
	}
}

/**
 * Fill-only-if-missing, deliberately excluding `reasoning` (see enrich.ts, which owns that field alone
 * behind a mandatory human-review gate - a source's flat "supports reasoning" flag says nothing about the
 * actual control mechanism, so it can never be trusted here).
 */
function fillNonReasoningCapabilities(
	text: NonNullable<CatalogEntry["operations"]["text.generate"]>,
	candidate: MatchedCandidate,
	names: ReadonlySet<string>,
): void {
	const model = anySourceModel(candidate);
	const vision = model?.inputModalities.includes("image") ?? false;
	text.capabilities ??= {};
	if (text.capabilities.tools === undefined)
		text.capabilities.tools = names.has("tools");
	if (text.capabilities.vision === undefined) text.capabilities.vision = vision;
	if (text.capabilities.structuredOutputs === undefined) {
		text.capabilities.structuredOutputs = names.has("structured_outputs");
	}
}

export interface MergeResult {
	entry: CatalogEntry;
	changes: string[];
	conflicts: NumericConflict[];
}

/**
 * Updates an existing OR near-empty stub catalog entry with fresh pricing/context/parameter/capability
 * data (see ensureOperations - a stub gets its `operations` populated first, so the same function serves
 * both "create" and "refresh"). Never touches `capabilities.reasoning` /
 * `operations["text.generate"].reasoning` - see enrich.ts, which owns those exclusively so the two
 * responsibilities can't accidentally interact.
 */
export function mergeCatalogEntry(
	existing: CatalogEntry,
	candidate: MatchedCandidate,
	modelsDevMatch: EnrichmentModel | undefined,
): MergeResult {
	const entry: CatalogEntry = structuredClone(existing);
	const changes: string[] = [];
	const conflicts: NumericConflict[] = [];
	ensureOperations(entry, candidate);
	const text = entry.operations["text.generate"];

	function applyNumeric(
		label: string,
		values: Partial<Record<NumericSourceKey, number>>,
		tolerance: number,
		current: number | undefined,
		set: (value: number) => void,
	): void {
		const { value, conflict } = resolveNumeric(label, values, tolerance);
		if (conflict) {
			conflicts.push(conflict);
			return;
		}
		// Absence of a resolved value is NOT evidence of removal: only act when sources actually agree.
		if (value === undefined || value === current) return;
		set(value);
		changes.push(`${label}: ${current ?? "unset"} -> ${value}`);
	}

	entry.pricing ??= {};
	for (const field of [
		"inputCentsPerMTokens",
		"outputCentsPerMTokens",
		"cacheReadCentsPerMTokens",
		"cacheWriteCentsPerMTokens",
	] as const) {
		applyNumeric(
			`pricing.${field}`,
			pricingValues(candidate, modelsDevMatch, field),
			PRICING_TOLERANCE,
			entry.pricing[field],
			(value) => {
				entry.pricing![field] = value;
			},
		);
	}

	if (text) {
		applyNumeric(
			"maxInputTokens",
			contextValues(candidate, modelsDevMatch),
			EXACT_TOLERANCE,
			text.maxInputTokens,
			(value) => {
				text.maxInputTokens = value;
			},
		);
		applyNumeric(
			"maxOutputTokens",
			maxTokensValues(candidate, modelsDevMatch),
			EXACT_TOLERANCE,
			text.maxOutputTokens,
			(value) => {
				text.maxOutputTokens = value;
			},
		);

		const names = supportedParameterNames(candidate);
		text.parameters ??= {};
		for (const name of names) {
			if (text.parameters[name] !== undefined) continue; // never downgrade a manually-set entry
			text.parameters[name] = true;
			changes.push(`parameters: added "${name}"`);
		}
		fillNonReasoningCapabilities(text, candidate, names);
	}

	return { entry, changes, conflicts };
}
