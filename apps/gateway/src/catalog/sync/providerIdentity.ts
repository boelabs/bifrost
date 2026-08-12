/**
 * Shared, source-agnostic provider recognition. Vercel AI Gateway and OpenRouter both use the same
 * "creator/model" id convention and the same provider_name/tag vocabulary, so one table drives matching
 * for both existence sources. models.dev uses its own provider vocabulary entirely (see
 * MODELS_DEV_PROVIDER_ALIASES below) and is matched separately in enrich.ts.
 */

export interface ProviderIdentityRule {
	adapterKey: string;
	/** "creator/" prefixes a source's model id can start with to be a candidate for this adapter. */
	idPrefixes: readonly string[];
	/** provider_name/tag values (before normalization) that confirm the candidate via its /endpoints call. */
	providerTags: readonly string[];
	/** Set when the id prefix alone is ambiguous between adapters (e.g. "openai/" -> openai or azureopenai). */
	requiresEndpointMatch?: boolean;
}

export const PROVIDER_IDENTITY: readonly ProviderIdentityRule[] = [
	{
		adapterKey: "openai",
		idPrefixes: ["openai/"],
		providerTags: ["openai"],
	},
	{
		adapterKey: "azureopenai",
		idPrefixes: ["openai/"],
		providerTags: ["azure"],
		requiresEndpointMatch: true,
	},
	{
		adapterKey: "anthropic",
		idPrefixes: ["anthropic/"],
		providerTags: ["anthropic"],
	},
	{
		adapterKey: "googleaistudio",
		idPrefixes: ["google/"],
		providerTags: ["google"],
	},
	{
		adapterKey: "deepseek",
		idPrefixes: ["deepseek/"],
		providerTags: ["deepseek"],
	},
	{
		adapterKey: "moonshot",
		idPrefixes: ["moonshotai/", "moonshot/"],
		providerTags: ["moonshot-ai", "moonshotai", "moonshot"],
	},
	{
		adapterKey: "zai",
		idPrefixes: ["z-ai/", "zai/"],
		providerTags: ["z-ai", "zai"],
	},
	{
		adapterKey: "minimax",
		idPrefixes: ["minimax/"],
		providerTags: ["minimax"],
	},
];

/**
 * models.dev keys its document by its OWN provider ids, which don't line up 1:1 with our adapterKeys or
 * with the OpenRouter/Vercel provider tags above (e.g. "moonshotai" here vs. our "moonshot" adapterKey).
 * "azure-cognitive-services" is intentionally left unmapped: models.dev tracks it as a distinct provider
 * (Azure AI Foundry/Cognitive Services resource) with no corresponding adapter registered today - fetch
 * still reports it as an unmapped provider for visibility, but nothing guesses a mapping for it.
 */
export const MODELS_DEV_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
	openai: "openai",
	anthropic: "anthropic",
	google: "googleaistudio",
	deepseek: "deepseek",
	moonshotai: "moonshot",
	zai: "zai",
	minimax: "minimax",
	azure: "azureopenai",
};

/** Lowercase, non-alphanumeric runs collapsed to a single "-", trimmed - the one normalizer every source
 * and every matcher in this module uses, so a tag/id spelled differently across sources still compares
 * equal (e.g. "Moonshot AI", "moonshot-ai", "moonshotai" all normalize to "moonshot-ai"/"moonshotai"-ish
 * forms that match consistently against each other). */
export function normalizeTag(value: string | undefined): string {
	return (value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

export interface AdapterCandidateMapping {
	adapterKey: string;
	upstreamModel: string;
	idPrefix: string;
	requiresEndpointMatch?: boolean;
}

/** Every (adapterKey, upstreamModel) a source's model id could plausibly map to, before endpoint disambiguation. */
export function candidateAdapterMappings(
	sourceModelId: string,
): AdapterCandidateMapping[] {
	const mappings: AdapterCandidateMapping[] = [];
	for (const rule of PROVIDER_IDENTITY) {
		for (const prefix of rule.idPrefixes) {
			if (!sourceModelId.startsWith(prefix)) continue;
			mappings.push({
				adapterKey: rule.adapterKey,
				upstreamModel: sourceModelId.slice(prefix.length),
				idPrefix: prefix,
				...(rule.requiresEndpointMatch ? { requiresEndpointMatch: true } : {}),
			});
		}
	}
	return mappings;
}

/** Does a source endpoint's raw provider tag confirm it belongs to the given adapter? */
export function endpointBelongsToAdapter(
	providerTag: string | undefined,
	adapterKey: string,
): boolean {
	const rule = PROVIDER_IDENTITY.find((item) => item.adapterKey === adapterKey);
	if (!rule) return false;
	const normalizedTag = normalizeTag(providerTag);
	return rule.providerTags.some(
		(candidate) => normalizeTag(candidate) === normalizedTag,
	);
}

/**
 * Fails fast (called at CLI startup, and asserted in a unit test) if PROVIDER_IDENTITY or
 * MODELS_DEV_PROVIDER_ALIASES references an adapterKey that isn't actually registered - e.g. a typo, or a
 * rule left behind after an adapter was removed. Without this, that rule would just silently never match
 * anything, and nothing else would notice.
 */
export function assertProviderIdentityRegistered(
	registeredAdapterKeys: Iterable<string>,
): void {
	const known = new Set(registeredAdapterKeys);
	const unknown = [
		...PROVIDER_IDENTITY.map((rule) => rule.adapterKey),
		...Object.values(MODELS_DEV_PROVIDER_ALIASES),
	].filter((adapterKey) => !known.has(adapterKey));
	if (unknown.length > 0) {
		throw new Error(
			`catalog/sync/providerIdentity.ts references unregistered adapter(s): ${[...new Set(unknown)].join(", ")}. ` +
				"Check PROVIDER_REGISTRATIONS in src/adapters/index.ts.",
		);
	}
}
