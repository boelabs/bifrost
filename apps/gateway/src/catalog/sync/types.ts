import type { RuntimeModelMetadata } from "#db/schema.ts";

/** Sources that vote on whether a (adapter, upstream model, provider) combination actually exists. */
export type ExistenceSourceKey = "vercel-ai-gateway" | "openrouter";

/** Sources that only enrich an already-existing candidate; never vote on existence. */
export type EnrichmentSourceKey = "models-dev";

export type NormalizedPricing = NonNullable<RuntimeModelMetadata["pricing"]>;

export interface SourceEndpoint {
	/** Raw provider_name/tag as the source reports it, before mapping to one of our adapterKeys. */
	providerTag: string;
	active: boolean;
	contextLength?: number;
	maxCompletionTokens?: number;
	pricing?: NormalizedPricing;
	supportedParameters?: string[];
}

export interface SourceModel {
	source: ExistenceSourceKey;
	/** "creator/model", the id convention both existence sources share. */
	id: string;
	name?: string;
	inputModalities: string[];
	outputModalities: string[];
	contextWindow?: number;
	maxTokens?: number;
	/** Model-level fallback pricing/parameters, used only when no per-endpoint match applies. */
	pricing?: NormalizedPricing;
	supportedParameters?: string[];
	/** Source-reported reasoning controls, retained for drift reports and human review. */
	reasoningOptions?: SourceReasoningOption[];
	endpoints: SourceEndpoint[];
}

export interface SourceFetchResult {
	source: ExistenceSourceKey;
	models: SourceModel[];
	attempted: number;
	/** Model ids whose per-endpoint call failed after retries. */
	failed: string[];
	/** True when the failure ratio is low enough to trust an absence as a real absence (see fetch.ts). */
	complete: boolean;
}

/** An existence source: votes on whether a (adapter, upstream model) is real and who serves it. */
export interface CatalogSource {
	readonly key: ExistenceSourceKey;
	readonly label: string;
	fetchModels(): Promise<SourceFetchResult>;
}

/** Source reasoning-control observation, kept distinct from the reviewed canonical ReasoningSpec. */
export type SourceReasoningOption =
	| { type: "toggle" }
	| { type: "effort"; values: string[] }
	| { type: "budget_tokens"; min?: number; max?: number };

/** Backwards-compatible name for models.dev enrichment code. */
export type ModelsDevReasoningOption = SourceReasoningOption;

/** Only what the sync consumes: numeric corroboration/tiebreak data plus the reasoning-draft inputs. */
export interface EnrichmentModel {
	/** models.dev's own provider key, e.g. "moonshotai" - see MODELS_DEV_PROVIDER_ALIASES to map it. */
	providerIdRaw: string;
	/** models.dev's own model key, e.g. "kimi-k2.6" - fuzzy-matched against our upstreamModel keys. */
	modelIdRaw: string;
	contextWindow?: number;
	maxOutputTokens?: number;
	/** Fallback tier only in merge.ts's tolerance resolution - never the sole trusted value. */
	pricing?: NormalizedPricing;
	reasoning?: boolean;
	reasoningOptions?: ModelsDevReasoningOption[];
}

export interface EnrichmentFetchResult {
	models: EnrichmentModel[];
	complete: boolean;
}

/**
 * An enrichment source: never participates in match.ts's existence gate (see the deliberately smaller,
 * distinct shape from CatalogSource - accidentally wiring an EnrichmentSource into match.ts is a type
 * error, not a runtime bug waiting to happen).
 */
export interface EnrichmentSource {
	readonly key: EnrichmentSourceKey;
	readonly label: string;
	fetchModels(): Promise<EnrichmentFetchResult>;
}
