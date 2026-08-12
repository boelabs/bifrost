import { makeAzurev1Adapter } from "#adapters/azurev1.ts";
import type { ProviderModule } from "#adapters/types.ts";

/** Foundry models sold by Azure: Chat Completions upstream; Responses is rendered locally. */
export const azurefoundryAdapter = makeAzurev1Adapter({
	key: "azurefoundry",
	label: "Azure Foundry v1",
	defaultTransport: "chat_completions",
	supportedChatTransports: ["chat_completions"],
});

export const azurefoundryProvider: ProviderModule = {
	adapter: azurefoundryAdapter,
};
