import { openaicompatibleAdapter } from "./openaicompatible/index.ts";
import { googleAdapter } from "./google/index.ts";
import type { AdapterContext } from "./types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	toOpenAIChatResponse,
	chatResponseSchema,
} from "#contracts/openai/chat.ts";

const ctx: AdapterContext = {
	upstreamModel: "m",
	credentials: { apiKey: "k" },
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: false,
			structuredOutputs: false,
		},
	},
	transport: "chat_completions",
	requestId: "t",
};

/**
 * The core of the project: two upstreams with different protocols produce, through their
 * adapters, a canonical response that serializes to the exact SAME OpenAI contract.
 */
test("agnosticism: OpenAI and Gemini -> identical output OpenAI contract", () => {
	const openaiRaw = {
		id: "chatcmpl-1",
		created: 1,
		model: "gpt-5.5",
		choices: [
			{
				index: 0,
				finish_reason: "stop",
				message: { role: "assistant", content: "Hola world" },
			},
		],
		usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
	};
	const geminiRaw = {
		candidates: [
			{
				content: { parts: [{ text: "Hola world" }] },
				finishReason: "STOP",
				index: 0,
			},
		],
		usageMetadata: {
			promptTokenCount: 5,
			candidatesTokenCount: 2,
			totalTokenCount: 7,
		},
	};

	const fromOpenAI = toOpenAIChatResponse(
		openaicompatibleAdapter.chat!.parseResponse(openaiRaw, ctx),
	);
	const fromGemini = toOpenAIChatResponse(
		googleAdapter.chat!.parseResponse(geminiRaw, ctx),
	);

	// Both satisfy the exact OpenAI schema.
	chatResponseSchema.parse(fromOpenAI);
	chatResponseSchema.parse(fromGemini);

	// The observable content and usage also match, regardless of upstream.
	assert.equal(fromOpenAI.object, "chat.completion");
	assert.equal(fromGemini.object, "chat.completion");
	assert.equal(
		fromOpenAI.choices[0]!.message.content,
		fromGemini.choices[0]!.message.content,
	);
	assert.equal(
		fromOpenAI.choices[0]!.finish_reason,
		fromGemini.choices[0]!.finish_reason,
	);
	assert.deepEqual(fromOpenAI.usage, fromGemini.usage);
});
