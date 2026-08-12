import type { ProviderModule } from "#adapters/types.ts";

import {
	makeOpenAIStyleAdapter,
	contextWindowRefine,
} from "#adapters/openaiStyle.ts";

/**
 * DeepSeek (api.deepseek.com). OpenAI-compatible API (chat/completions). V4 declares top-level
 * thinking and `reasoning_effort` high/max from the catalog.
 */
export const deepseekAdapter = makeOpenAIStyleAdapter({
	key: "deepseek",
	label: "DeepSeek",
	defaultBaseUrl: "https://api.deepseek.com/v1",
	defaultTransport: "chat_completions",
	maxTokensField: "max_tokens",
	refineBadRequest: contextWindowRefine,
});

export const deepseekProvider: ProviderModule = { adapter: deepseekAdapter };
