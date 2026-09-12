import type {
	ExistenceSourceKey,
	SourceFetchResult,
	SourceEndpoint,
	SourceModel,
} from "./types.ts";

import {
	candidateAdapterMappings,
	endpointBelongsToAdapter,
} from "./providerIdentity.ts";

export interface MatchedCandidate {
	adapterKey: string;
	upstreamModel: string;
	bySource: Partial<
		Record<
			ExistenceSourceKey,
			{ model: SourceModel; endpoint: SourceEndpoint | undefined }
		>
	>;
	/** True iff both existence sources (Vercel AI Gateway and OpenRouter) independently reported this. */
	confirmed: boolean;
}

function candidateKey(adapterKey: string, upstreamModel: string): string {
	return `${adapterKey}::${upstreamModel}`;
}

/**
 * For one source's model, resolves every (adapterKey, upstreamModel, endpoint) it could plausibly
 * contribute to a match. An ambiguous id prefix (e.g. "openai/" matching both `openai` and `azureopenai`)
 * is disambiguated by the endpoint's provider tag; when disambiguation is required and no endpoint
 * confirms it, that candidate mapping is dropped rather than guessed.
 */
function candidatesForModel(model: SourceModel): Array<{
	adapterKey: string;
	upstreamModel: string;
	endpoint: SourceEndpoint | undefined;
}> {
	const results: Array<{
		adapterKey: string;
		upstreamModel: string;
		endpoint: SourceEndpoint | undefined;
	}> = [];
	for (const mapping of candidateAdapterMappings(model.id)) {
		const matchedEndpoint = model.endpoints.find((endpoint) =>
			endpointBelongsToAdapter(endpoint.providerTag, mapping.adapterKey),
		);
		if (mapping.requiresEndpointMatch && !matchedEndpoint) continue;
		results.push({
			adapterKey: mapping.adapterKey,
			upstreamModel: mapping.upstreamModel,
			endpoint: matchedEndpoint ?? model.endpoints[0],
		});
	}
	return results;
}

export function matchCandidates(
	results: readonly SourceFetchResult[],
): MatchedCandidate[] {
	const byKey = new Map<string, MatchedCandidate>();
	for (const result of results) {
		for (const model of result.models) {
			for (const candidate of candidatesForModel(model)) {
				const key = candidateKey(candidate.adapterKey, candidate.upstreamModel);
				const existing = byKey.get(key) ?? {
					adapterKey: candidate.adapterKey,
					upstreamModel: candidate.upstreamModel,
					bySource: {},
					confirmed: false,
				};
				existing.bySource[result.source] = {
					model,
					endpoint: candidate.endpoint,
				};
				byKey.set(key, existing);
			}
		}
	}
	for (const candidate of byKey.values()) {
		candidate.confirmed = Object.keys(candidate.bySource).length >= 2;
	}
	return [...byKey.values()];
}
