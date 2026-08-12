import type { ProviderModule } from "#adapters/types.ts";

import {
	makeOpenAIStyleAdapter,
	contextWindowRefine,
} from "#adapters/openaiStyle.ts";

/**
 * ZAI AI / Z.ai (GLM). OpenAI-compatible API. International Z.ai base by default; for China the
 * operator can set baseUrl = https://open.bigmodel.cn/api/paas/v4. The catalog models top-level
 * `thinking` and, for GLM-5.2+, `reasoning_effort`.
 */
export const zaiAdapter = makeOpenAIStyleAdapter({
	key: "zai",
	label: "ZAI AI",
	defaultBaseUrl: "https://api.z.ai/api/paas/v4",
	defaultTransport: "chat_completions",
	maxTokensField: "max_tokens",
	refineBadRequest: contextWindowRefine,
});

export const zaiProvider: ProviderModule = { adapter: zaiAdapter };
