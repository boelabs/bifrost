import type { CanonicalEmbeddingsRequest } from "#core/embeddings.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import { azurefoundryAdapter } from "./azurefoundry/index.ts";
import { azureopenaiAdapter } from "./azureopenai/index.ts";
import { normalizeAzurev1BaseUrl } from "./azurev1.ts";
import type { AdapterContext } from "./types.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const request: CanonicalChatRequest = {
	callType: "chat",
	model: "public-model",
	messages: [{ role: "user", content: "hello" }],
	stream: false,
	maxTokens: 256,
};

const embeddingsRequest: CanonicalEmbeddingsRequest = {
	model: "embed",
	input: ["hello", "world"],
	encodingFormat: "float",
	dimensions: 512,
};

function context(
	transport: AdapterContext["transport"],
	model: string,
): AdapterContext {
	return {
		upstreamModel: model,
		transport: transport,
		credentials: {
			apiKey: "azure-secret",
			baseUrl: "https://omni-resource.openai.azure.com",
		},
		meta: {
			capabilities: {
				tools: true,
				vision: true,
				reasoning: false,
				structuredOutputs: true,
			},
		},
		requestId: "azure-test",
	};
}

test("azureopenai: uses /openai/v1/responses, api-key, and deployment=model", () => {
	const built = azureopenaiAdapter.chat!.buildRequest(
		request,
		context("responses", "gpt-5.4"),
	);
	assert.equal(
		built.url,
		"https://omni-resource.openai.azure.com/openai/v1/responses",
	);
	assert.equal(built.headers["api-key"], "azure-secret");
	assert.equal(built.headers.authorization, undefined);
	const body = JSON.parse(built.body!);
	assert.equal(body.model, "gpt-5.4");
	assert.equal(body.max_output_tokens, 256);
});

test("azureopenai: uses /openai/v1/embeddings, api-key, and OpenAI body", () => {
	const handler = azureopenaiAdapter.embeddings;
	assert.ok(handler);
	const built = handler.buildRequest(
		embeddingsRequest,
		context("embeddings", "text-embedding-3-small"),
	);
	assert.equal(
		built.url,
		"https://omni-resource.openai.azure.com/openai/v1/embeddings",
	);
	assert.equal(built.headers["api-key"], "azure-secret");
	assert.equal(built.headers.authorization, undefined);
	const body = JSON.parse(built.body!);
	assert.deepEqual(body, {
		model: "text-embedding-3-small",
		input: ["hello", "world"],
		encoding_format: "float",
		dimensions: 512,
	});
});

test("azurefoundry: uses modern Chat Completions and max_completion_tokens", () => {
	const built = azurefoundryAdapter.chat!.buildRequest(request, {
		...context("chat_completions", "DeepSeek-V3.1"),
		credentials: {
			apiKey: "azure-secret",
			baseUrl: "https://omni-resource.services.ai.azure.com/openai/v1/",
		},
	});
	assert.equal(
		built.url,
		"https://omni-resource.services.ai.azure.com/openai/v1/chat/completions",
	);
	assert.equal(built.headers["api-key"], "azure-secret");
	const body = JSON.parse(built.body!);
	assert.equal(body.model, "DeepSeek-V3.1");
	assert.equal(body.max_completion_tokens, 256);
	assert.equal(body.max_tokens, undefined);
});

test("azurefoundry: DeepSeek V4 keeps xhigh distinct from native max", () => {
	const reasoning = {
		kind: "openai_effort" as const,
		levels: ["none", "high", "max"] as ("none" | "high" | "max")[],
	};

	for (const [effort, upstream] of [
		["none", "none"],
		["high", "high"],
		["xhigh", "high"],
		["max", "max"],
	] as const) {
		const built = azurefoundryAdapter.chat!.buildRequest(
			{ ...request, reasoning: { effort } },
			{
				...context("chat_completions", "DeepSeek-V4-Flash"),
				meta: {
					capabilities: {
						tools: false,
						vision: false,
						reasoning: true,
						structuredOutputs: false,
					},
					reasoning,
				},
			},
		);

		assert.equal(JSON.parse(built.body!).reasoning_effort, upstream);
	}
});

test("azurefoundry: Kimi is a fixed high reasoner without inventing an upstream knob", () => {
	const fixedReasoning = {
		kind: "fixed" as const,
		levels: ["high"] as "high"[],
	};
	const ctx: AdapterContext = {
		...context("chat_completions", "Kimi-K2.6"),
		meta: {
			capabilities: {
				tools: true,
				vision: true,
				reasoning: true,
				structuredOutputs: false,
			},
			reasoning: fixedReasoning,
		},
	};

	for (const reasoning of [undefined, { effort: "high" as const }]) {
		const req: CanonicalChatRequest =
			reasoning === undefined ? request : { ...request, reasoning };
		const built = azurefoundryAdapter.chat!.buildRequest(req, ctx);
		const body = JSON.parse(built.body!);
		assert.equal(body.reasoning_effort, undefined);
		assert.equal(body.thinking, undefined);
	}
});

test("azure adapters: modular transports without images", () => {
	assert.deepEqual(azureopenaiAdapter.transports?.chat?.supported, [
		"responses",
		"chat_completions",
	]);
	assert.equal(azureopenaiAdapter.transports?.chat?.default, "responses");
	assert.deepEqual(azureopenaiAdapter.transports?.embeddings?.supported, [
		"embeddings",
	]);
	assert.equal(
		azureopenaiAdapter.transports?.embeddings?.default,
		"embeddings",
	);
	assert.deepEqual(azurefoundryAdapter.transports?.chat?.supported, [
		"chat_completions",
	]);
	assert.equal(
		azurefoundryAdapter.transports?.chat?.default,
		"chat_completions",
	);
	assert.equal(azureopenaiAdapter.imageGeneration, undefined);
	assert.ok(azureopenaiAdapter.embeddings);
	assert.equal(azurefoundryAdapter.imageGeneration, undefined);
	assert.equal(azurefoundryAdapter.embeddings, undefined);
});

test("azurefoundry: rejects forced Responses upstream", () => {
	assert.throws(
		() =>
			azurefoundryAdapter.chat!.buildRequest(
				request,
				context("responses", "DeepSeek-V3.1"),
			),
		(error) => GatewayError.is(error) && /not supported/.test(error.message),
	);
});

test("azure v1: normalizes endpoint and rejects legacy deployments/api-version", () => {
	assert.equal(
		normalizeAzurev1BaseUrl("https://resource.openai.azure.com/"),
		"https://resource.openai.azure.com/openai/v1",
	);
	assert.equal(
		normalizeAzurev1BaseUrl(
			"https://resource.services.ai.azure.com/openai/v1/",
		),
		"https://resource.services.ai.azure.com/openai/v1",
	);
	assert.throws(
		() =>
			normalizeAzurev1BaseUrl(
				"https://resource.openai.azure.com/openai/deployments/gpt",
			),
		/legacy/,
	);
	assert.throws(
		() =>
			normalizeAzurev1BaseUrl(
				"https://resource.openai.azure.com/openai/v1?api-version=2025-01-01",
			),
		/query parameters/,
	);
});
