import type { Adapter, ProviderModule } from "#adapters/types.ts";
import { makeOpenRouterRerankHandler } from "./rerank.ts";

export const openrouterAdapter = {
	key: "openrouter",
	credentials: { required: ["apiKey"] },
	supportedCallTypes: new Set(["rerank"]),
	rerank: makeOpenRouterRerankHandler(),
	transports: {
		rerank: {
			supported: ["openrouter_rerank"],
			default: "openrouter_rerank",
		},
	},
} satisfies Adapter;

export const openrouterProvider: ProviderModule = {
	adapter: openrouterAdapter,
};
