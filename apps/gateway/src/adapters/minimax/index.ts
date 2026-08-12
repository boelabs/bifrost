import type { ProviderModule } from "#adapters/types.ts";

import {
	makeOpenAIStyleAdapter,
	contextWindowRefine,
} from "#adapters/openaiStyle.ts";

/**
 * MiniMax (api.minimax.io). OpenAI-compatible API. MiniMax-M1/M2 reason and return
 * `reasoning_content` (parsed by the OpenAI transport) without an effort knob. For the China cloud the
 * operator can set baseUrl = https://api.minimaxi.chat/v1.
 */
export const minimaxAdapter = makeOpenAIStyleAdapter({
	key: "minimax",
	label: "MiniMax",
	defaultBaseUrl: "https://api.minimax.io/v1",
	defaultTransport: "chat_completions",
	maxTokensField: "max_tokens",
	refineBadRequest: contextWindowRefine,
});

export const minimaxProvider: ProviderModule = { adapter: minimaxAdapter };
