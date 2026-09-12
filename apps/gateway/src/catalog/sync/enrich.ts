import type { ModelsDevReasoningOption, EnrichmentModel } from "./types.ts";
import type { CatalogEntry } from "#catalog/types.ts";
import type { MatchedCandidate } from "./match.ts";

import {
	type ReasoningControlKind,
	type ReasoningEffort,
	isReasoningEffort,
} from "#core/reasoning.ts";

import {
	MODELS_DEV_PROVIDER_ALIASES,
	normalizeTag,
} from "./providerIdentity.ts";

const CORROBORATION_TOLERANCE = 0.1; // 10%: "is this plausibly the same model," not "which number is right"
const REASONING_PATH = "operations.text.generate.reasoning";

function within(a: number, b: number, relativeTolerance: number): boolean {
	const scale = Math.max(Math.abs(a), Math.abs(b), 1e-9);
	return Math.abs(a - b) / scale <= relativeTolerance;
}

function existenceNumeric(
	candidate: MatchedCandidate,
	pick: (values: {
		contextLength: number | undefined;
		input: number | undefined;
	}) => number | undefined,
): number | undefined {
	for (const source of ["vercel-ai-gateway", "openrouter"] as const) {
		const bySource = candidate.bySource[source];
		if (!bySource) continue;
		const value = pick({
			contextLength:
				bySource.endpoint?.contextLength ?? bySource.model.contextWindow,
			input:
				bySource.endpoint?.pricing?.inputCentsPerMTokens ??
				bySource.model.pricing?.inputCentsPerMTokens,
		});
		if (value !== undefined) return value;
	}
	return undefined;
}

/**
 * Finds the models.dev entry (if any) that corresponds to a matched existence candidate. models.dev uses
 * its own provider/model id vocabulary, so this is a fuzzy name match through MODELS_DEV_PROVIDER_ALIASES
 * - guarded by requiring at least one numeric field (context window or input price) to roughly agree with
 * what the existence sources reported, so a name collision (two unrelated models normalizing to the same
 * string) can't silently attach the wrong metadata. A fuzzy match with no numeric corroboration is
 * reported as ambiguous by the caller, never applied.
 */
export function findModelsDevMatch(
	candidate: MatchedCandidate,
	modelsDevModels: readonly EnrichmentModel[],
): { match: EnrichmentModel; corroborated: boolean } | undefined {
	const aliasProviderIds = Object.entries(MODELS_DEV_PROVIDER_ALIASES)
		.filter(([, adapterKey]) => adapterKey === candidate.adapterKey)
		.map(([providerIdRaw]) => providerIdRaw);
	if (aliasProviderIds.length === 0) return undefined;

	const normalizedUpstream = normalizeTag(candidate.upstreamModel);
	const nameMatches = modelsDevModels.filter(
		(model) =>
			aliasProviderIds.includes(model.providerIdRaw) &&
			normalizeTag(model.modelIdRaw) === normalizedUpstream,
	);
	if (nameMatches.length === 0) return undefined;

	const existenceContext = existenceNumeric(candidate, (v) => v.contextLength);
	const existenceInputPrice = existenceNumeric(candidate, (v) => v.input);

	for (const match of nameMatches) {
		const contextAgrees =
			existenceContext !== undefined &&
			match.contextWindow !== undefined &&
			within(existenceContext, match.contextWindow, CORROBORATION_TOLERANCE);
		const priceAgrees =
			existenceInputPrice !== undefined &&
			match.pricing?.inputCentsPerMTokens !== undefined &&
			within(
				existenceInputPrice,
				match.pricing.inputCentsPerMTokens,
				CORROBORATION_TOLERANCE,
			);
		if (contextAgrees || priceAgrees) return { match, corroborated: true };
	}
	// Nothing corroborated: return the first name match anyway so the caller can report it as ambiguous,
	// but callers must check `corroborated` before applying anything from it.
	return { match: nameMatches[0]!, corroborated: false };
}

/**
 * Best-effort translation of models.dev's `reasoning_options` into a DRAFT of our ReasoningSpec. Only the
 * parts a public catalog can actually express are filled in (which canonical levels exist); the wire-level
 * mechanics (`kind`, `bodyField`, `chatTemplateFlag`, `effortField`) encode literal request-construction
 * details only our adapter code knows, so they're never guessed here - `kind` gets the single most
 * plausible value already in use elsewhere in the same adapter's catalog (a hint), everything else is left
 * for the human review this draft is gated behind (see needsHumanReview in the caller).
 */
export function draftReasoningLevels(
	options: readonly ModelsDevReasoningOption[],
): { levels: ReasoningEffort[]; unrecognized: string[] } {
	const levels = new Set<ReasoningEffort>();
	const unrecognized: string[] = [];
	let hasToggle = false;
	for (const option of options) {
		if (option.type === "toggle") {
			hasToggle = true;
		} else if (option.type === "effort") {
			for (const raw of option.values) {
				const normalized = raw.toLowerCase().trim();
				if (isReasoningEffort(normalized)) {
					levels.add(normalized);
				} else {
					unrecognized.push(raw);
				}
			}
		}
		// budget_tokens contributes no discrete levels - a single min/max range can't be split into our
		// per-level ladder without guessing; it's surfaced in the review note by the caller instead.
	}
	if (hasToggle && levels.size === 0) {
		// Toggle with no effort ladder at all: the documented binary pattern (on = highest rung).
		levels.add("high");
	}
	if (hasToggle) levels.add("none");
	return { levels: [...levels], unrecognized };
}

/**
 * Kinds that `jsonCatalog.ts`'s loader-level validation requires an extra sub-object for
 * (`bodyField`/`chatTemplateFlag`, carrying the literal upstream param name and on/off values) - wire
 * mechanics we've already established we can't safely guess. Every other kind is structurally complete
 * with just `{kind, levels}`, so those are the only ones this function may ever draft.
 */
const KINDS_REQUIRING_UNDRAFTABLE_CONFIG = new Set<ReasoningControlKind>([
	"openai_body",
	"chat_template_flag",
]);

/**
 * The most plausible kind for a draft, restricted to ones the loader will accept without extra config.
 * Returns undefined when every kind already in use for this adapter needs config we can't draft (e.g. an
 * adapter that's exclusively `openai_body` today) - the caller must not draft a reasoning spec at all in
 * that case, only flag the gap for a human to fill in by hand.
 */
function likelySafeReasoningKind(
	adapterKey: string,
	kindsInUseByAdapter: ReadonlyMap<string, readonly ReasoningControlKind[]>,
): ReasoningControlKind | undefined {
	const inUse = kindsInUseByAdapter.get(adapterKey) ?? [];
	const safe = inUse.find(
		(kind) => !KINDS_REQUIRING_UNDRAFTABLE_CONFIG.has(kind),
	);
	if (safe) return safe;
	if (inUse.length === 0) return "openai_effort"; // no prior art for this adapter; needs no extra config
	return undefined; // every kind in use here requires config we can't infer
}

export interface EnrichResult {
	entry: CatalogEntry;
	changes: string[];
}

/**
 * Applies models.dev enrichment to a matched candidate's entry (new or existing). `modelsDevMatch` is
 * already resolved (and corroborated - see findModelsDevMatch) by the caller, which also needs it for
 * merge.ts's numeric tiebreak before this runs, so it's resolved once and passed in rather than
 * re-derived here. The reasoning spec is drafted - real progress, not just a comment - but always
 * paired with a `needsHumanReview` marker that `scripts/validate-catalog.ts` treats as a hard failure
 * until a human clears it. An entry whose reasoning is already verified (capabilities.reasoning is true
 * with no marker) is never touched again here, even if models.dev's data changes - re-drafting a
 * human-verified spec would be a regression, not an enrichment.
 */
export function enrichCatalogEntry(
	existing: CatalogEntry,
	candidate: MatchedCandidate,
	modelsDevMatch: EnrichmentModel | undefined,
	kindsInUseByAdapter: ReadonlyMap<string, readonly ReasoningControlKind[]>,
): EnrichResult {
	const entry: CatalogEntry = structuredClone(existing);
	const changes: string[] = [];

	if (!modelsDevMatch) return { entry, changes };
	const match = modelsDevMatch;

	const text = entry.operations["text.generate"];
	const reasoningAlreadyVerified =
		text?.capabilities?.reasoning === true &&
		!(entry.needsHumanReview ?? []).includes(REASONING_PATH);

	if (
		text &&
		match.reasoning &&
		match.reasoningOptions &&
		!reasoningAlreadyVerified
	) {
		const { levels, unrecognized } = draftReasoningLevels(
			match.reasoningOptions,
		);
		if (levels.length > 0) {
			const safeKind = likelySafeReasoningKind(
				candidate.adapterKey,
				kindsInUseByAdapter,
			);
			const unrecognizedNote =
				unrecognized.length > 0
					? ` Native levels from models.dev not in our canonical vocabulary, dropped from the ` +
						`draft: ${unrecognized.join(", ")}. For each, decide whether it's a synonymous label for an ` +
						"existing level (add an upstreamEffortMap entry), a distinct tier that requires extending " +
						"the canonical vocabulary, a separate mode/endpoint with its own pricing, or safe to ignore - check the " +
						"provider's docs."
					: "";
			let notes: string;
			if (safeKind) {
				// Structurally complete on its own: `safeKind` is guaranteed to need no extra sub-object
				// (see KINDS_REQUIRING_UNDRAFTABLE_CONFIG), so {kind, levels} alone passes jsonCatalog.ts's
				// loader validation - this is real, usable progress, not a half-written object.
				text.capabilities = { ...text.capabilities, reasoning: true };
				text.reasoning = { kind: safeKind, levels };
				notes =
					"Reasoning spec auto-drafted from models.dev - unverified. Confirm `kind` against the " +
					"provider's actual API docs, then clear needsHumanReview." +
					unrecognizedNote;
			} else {
				// Every kind already in use for this adapter (e.g. openai_body) requires a sub-object
				// (bodyField's literal param name/values) we cannot infer - writing a spec with just
				// {kind, levels} would fail jsonCatalog.ts's own loader validation and break catalog
				// loading entirely, not just this gate. Nothing is written; capabilities.reasoning stays
				// unset rather than true-with-no-way-to-activate-it.
				notes =
					"models.dev indicates likely reasoning support, but every reasoning kind already used " +
					`by this adapter (${(kindsInUseByAdapter.get(candidate.adapterKey) ?? []).join(", ") || "none on record"}) ` +
					"requires config (bodyField/chatTemplateFlag) this sync can't infer - add the full " +
					"ReasoningSpec by hand; nothing was drafted." +
					unrecognizedNote;
			}
			entry.notes = entry.notes ? `${entry.notes}\n${notes}` : notes;
			entry.needsHumanReview = [
				...new Set([...(entry.needsHumanReview ?? []), REASONING_PATH]),
			];
			changes.push(
				safeKind
					? "reasoning: drafted from models.dev (needs human review)"
					: "reasoning: flagged from models.dev, not drafted (needs manual authorship)",
			);
		}
	}

	return { entry, changes };
}
