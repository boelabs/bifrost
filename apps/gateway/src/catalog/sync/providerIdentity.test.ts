import { MODEL_CATALOG } from "#adapters/index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	assertProviderIdentityRegistered,
	MODELS_DEV_PROVIDER_ALIASES,
	candidateAdapterMappings,
	endpointBelongsToAdapter,
	PROVIDER_IDENTITY,
	normalizeTag,
} from "./providerIdentity.ts";

test("PROVIDER_IDENTITY and MODELS_DEV_PROVIDER_ALIASES only reference registered adapters", () => {
	assertProviderIdentityRegistered(Object.keys(MODEL_CATALOG));
});

test("candidateAdapterMappings maps first-party model prefixes to adapter catalogs", () => {
	assert.deepEqual(candidateAdapterMappings("anthropic/claude-sonnet-5"), [
		{
			adapterKey: "anthropic",
			upstreamModel: "claude-sonnet-5",
			idPrefix: "anthropic/",
		},
	]);
	assert.deepEqual(candidateAdapterMappings("openrouter/fusion"), []);
});

test("candidateAdapterMappings surfaces both candidates for an ambiguous prefix", () => {
	const mappings = candidateAdapterMappings("openai/gpt-5.5");
	assert.deepEqual(mappings.map((m) => m.adapterKey).sort(), [
		"azureopenai",
		"openai",
	]);
	const azure = mappings.find((m) => m.adapterKey === "azureopenai");
	assert.equal(azure?.requiresEndpointMatch, true);
	const openai = mappings.find((m) => m.adapterKey === "openai");
	assert.equal(openai?.requiresEndpointMatch, undefined);
});

test("endpointBelongsToAdapter matches by normalized provider tag", () => {
	assert.equal(endpointBelongsToAdapter("anthropic", "anthropic"), true);
	assert.equal(endpointBelongsToAdapter("google", "anthropic"), false);
	assert.equal(endpointBelongsToAdapter("Azure", "azureopenai"), true);
	assert.equal(endpointBelongsToAdapter("Moonshot AI", "moonshot"), true);
});

test("normalizeTag collapses case/punctuation differences consistently", () => {
	assert.equal(normalizeTag("Moonshot AI"), normalizeTag("moonshot-ai"));
	assert.equal(normalizeTag("moonshotai"), "moonshotai");
	assert.equal(normalizeTag(undefined), "");
});

test("every PROVIDER_IDENTITY rule with requiresEndpointMatch shares its id prefix with an unmarked rule", () => {
	// Sanity check on the table itself: an ambiguous prefix only makes sense if there's another rule to
	// disambiguate against.
	for (const rule of PROVIDER_IDENTITY) {
		if (!rule.requiresEndpointMatch) continue;
		const sharesPrefix = PROVIDER_IDENTITY.some(
			(other) =>
				other !== rule &&
				other.idPrefixes.some((prefix) => rule.idPrefixes.includes(prefix)),
		);
		assert.ok(
			sharesPrefix,
			`${rule.adapterKey} requiresEndpointMatch but has a unique prefix`,
		);
	}
});

test("MODELS_DEV_PROVIDER_ALIASES values are all real adapterKeys used by PROVIDER_IDENTITY or the registry", () => {
	const known = new Set(Object.keys(MODEL_CATALOG));
	for (const adapterKey of Object.values(MODELS_DEV_PROVIDER_ALIASES)) {
		assert.ok(known.has(adapterKey), `unknown adapterKey "${adapterKey}"`);
	}
});
