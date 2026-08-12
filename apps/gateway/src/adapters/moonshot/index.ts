import type { ProviderModule } from "#adapters/types.ts";

import {
	makeOpenAIStyleAdapter,
	contextWindowRefine,
} from "#adapters/openaiStyle.ts";

/**
 * Moonshot AI / Kimi (api.moonshot.ai). OpenAI-compatible API. International base by default; for the
 * China cloud the operator can set baseUrl = https://api.moonshot.cn/v1. The Kimi K2 models declare
 * the `thinking` control in their catalog.
 */
export const moonshotAdapter = makeOpenAIStyleAdapter({
	key: "moonshot",
	label: "Moonshot",
	defaultBaseUrl: "https://api.moonshot.ai/v1",
	defaultTransport: "chat_completions",
	maxTokensField: "max_tokens",
	refineBadRequest: contextWindowRefine,
});

export const moonshotProvider: ProviderModule = { adapter: moonshotAdapter };
