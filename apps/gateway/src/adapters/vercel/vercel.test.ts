import { resolveModelMetadata, getCatalogEntry } from "#catalog/index.ts";
import { type ReasoningSpec, reasoningLogInfo } from "#core/reasoning.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { vercelAdapter } from "./index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

function ctx(
	upstreamModel: string,
	transport: AdapterContext["transport"],
): AdapterContext {
	return {
		upstreamModel,
		credentials: { apiKey: "vercel-test-key" },
		meta: resolveModelMetadata("vercel", upstreamModel),
		transport,
		requestId: "req_test",
	};
}

function ctxWithReasoning(
	upstreamModel: string,
	transport: AdapterContext["transport"],
	reasoning: ReasoningSpec,
): AdapterContext {
	const context = ctx(upstreamModel, transport);
	return {
		...context,
		meta: {
			...context.meta,
			capabilities: { ...context.meta.capabilities, reasoning: true },
			reasoning,
		},
	};
}

const baseRequest: CanonicalChatRequest = {
	callType: "chat",
	model: "public-model",
	messages: [{ role: "user", content: "hello" }],
	stream: false,
	maxTokens: 256,
};

test("vercel registers the operations supported by the existing core", () => {
	assert.deepEqual(vercelAdapter.transports?.chat, {
		supported: ["responses", "chat_completions"],
		default: "responses",
	});
	assert.ok(vercelAdapter.supportedCallTypes.has("chat"));
	assert.ok(vercelAdapter.supportedCallTypes.has("embeddings"));
	assert.ok(vercelAdapter.supportedCallTypes.has("images.generations"));
	assert.ok(vercelAdapter.supportedCallTypes.has("images.edits"));
	assert.ok(vercelAdapter.supportedCallTypes.has("rerank"));
	assert.deepEqual(vercelAdapter.transports?.rerank, {
		supported: ["cohere_rerank"],
		default: "cohere_rerank",
	});
	assert.equal(vercelAdapter.audioTranscription, undefined);
	assert.equal(vercelAdapter.videoGeneration, undefined);
});

test("vercel owns creator/model metadata from its public catalog", () => {
	assert.notEqual(
		getCatalogEntry("vercel", "openai/gpt-5.6-sol"),
		getCatalogEntry("openai", "gpt-5.6-sol"),
	);
	assert.notEqual(
		getCatalogEntry("vercel", "anthropic/claude-opus-5"),
		getCatalogEntry("anthropic", "claude-opus-5"),
	);
	assert.equal(getCatalogEntry("vercel", "unknown/model"), undefined);

	const metadata = resolveModelMetadata("vercel", "openai/gpt-5.6-sol");
	assert.equal(metadata.reasoning?.kind, "openai_effort");
	assert.ok(metadata.reasoning?.levels.includes("xhigh"));
	assert.equal(metadata.reasoning?.levels.includes("max"), true);
	assert.deepEqual(reasoningLogInfo({ effort: "max" }, metadata.reasoning), {
		requested: "max",
		effective: "max",
		clamped: false,
		source: "client",
	});

	const anthropic = resolveModelMetadata("vercel", "anthropic/claude-opus-5");
	assert.deepEqual(anthropic.reasoning, {
		kind: "fixed",
		levels: ["high"],
	});

	const minimax = resolveModelMetadata("vercel", "minimax/minimax-m3");
	assert.equal(minimax.maxOutputTokens, 1_000_000);
	assert.deepEqual(minimax.reasoning, {
		kind: "openai_effort",
		levels: ["none", "high"],
	});
	assert.equal(minimax.pricing?.tiers?.[0]?.aboveInputTokens, 512_000);
	assert.equal(minimax.pricing?.tiers?.[0]?.inputCentsPerMTokens, 120);
	assert.equal(minimax.pricing?.tiers?.[0]?.outputCentsPerMTokens, 480);

	const withoutMax = resolveModelMetadata("vercel", "openai/gpt-5.5");
	assert.deepEqual(reasoningLogInfo({ effort: "max" }, withoutMax.reasoning), {
		requested: "max",
		effective: "xhigh",
		clamped: true,
		source: "clamped",
	});
});

test("vercel Responses preserves OpenAI max as distinct from xhigh", () => {
	const request = vercelAdapter.chat!.buildRequest(
		{ ...baseRequest, reasoning: { effort: "max" } },
		ctx("openai/gpt-5.6-sol", "responses"),
	);
	assert.equal(request.url, "https://ai-gateway.vercel.sh/v1/responses");
	assert.equal(request.headers.authorization, "Bearer vercel-test-key");
	const body = JSON.parse(request.body!);
	assert.equal(body.model, "openai/gpt-5.6-sol");
	assert.equal(body.reasoning.effort, "max");
	assert.equal(body.reasoning.summary, "auto");
	assert.equal(body.max_output_tokens, 256);
});

test("vercel Responses emits native Anthropic and Bedrock reasoning for fallbacks", () => {
	const request = vercelAdapter.chat!.buildRequest(
		{
			...baseRequest,
			reasoning: { effort: "max", display: "omitted" },
			extraBody: {
				providerOptions: {
					gateway: { order: ["anthropic", "bedrock"] },
				},
			},
		},
		ctxWithReasoning("anthropic/claude-opus-5", "responses", {
			kind: "anthropic_adaptive",
			levels: ["none", "low", "medium", "high", "xhigh", "max"],
		}),
	);
	const body = JSON.parse(request.body!);
	assert.equal(body.reasoning, undefined);
	assert.deepEqual(body.providerOptions, {
		gateway: { order: ["anthropic", "bedrock"] },
		anthropic: {
			thinking: { type: "adaptive", display: "omitted" },
			effort: "max",
		},
		bedrock: {
			reasoningConfig: {
				type: "adaptive",
				maxReasoningEffort: "max",
				display: "omitted",
			},
		},
	});

	const chatRequest = vercelAdapter.chat!.buildRequest(
		{ ...baseRequest, reasoning: { effort: "max" } },
		ctxWithReasoning("anthropic/claude-opus-5", "chat_completions", {
			kind: "anthropic_adaptive",
			levels: ["none", "low", "medium", "high", "xhigh", "max"],
		}),
	);
	const chatBody = JSON.parse(chatRequest.body!);
	assert.equal(chatBody.reasoning, undefined);
	assert.equal(chatBody.providerOptions.anthropic.effort, "max");
	assert.equal(
		chatBody.providerOptions.bedrock.reasoningConfig.maxReasoningEffort,
		"max",
	);
});

test("vercel Chat emits its normalized reasoning object without aliasing max", () => {
	const request = vercelAdapter.chat!.buildRequest(
		{
			...baseRequest,
			reasoning: { effort: "max", display: "omitted" },
			extraBody: {
				providerOptions: {
					gateway: { only: ["openai"], sort: "tps" },
				},
			},
		},
		ctx("openai/gpt-5.6-sol", "chat_completions"),
	);
	assert.equal(request.url, "https://ai-gateway.vercel.sh/v1/chat/completions");
	const body = JSON.parse(request.body!);
	assert.equal(body.reasoning_effort, undefined);
	assert.deepEqual(body.reasoning, {
		enabled: true,
		effort: "max",
		exclude: true,
	});
	assert.deepEqual(body.providerOptions, {
		gateway: { only: ["openai"], sort: "tps" },
	});

	const xhighRequest = vercelAdapter.chat!.buildRequest(
		{ ...baseRequest, reasoning: { effort: "xhigh" } },
		ctx("openai/gpt-5.6-sol", "chat_completions"),
	);
	assert.equal(JSON.parse(xhighRequest.body!).reasoning.effort, "xhigh");
});

test("vercel maps Gemini levels and budgets into both Google execution namespaces", () => {
	const levelRequest = vercelAdapter.chat!.buildRequest(
		{ ...baseRequest, reasoning: { effort: "max" } },
		ctxWithReasoning("google/gemini-3.1-pro-preview", "responses", {
			kind: "gemini_level",
			levels: ["low", "medium", "high"],
		}),
	);
	const levelBody = JSON.parse(levelRequest.body!);
	assert.equal(levelBody.reasoning, undefined);
	assert.deepEqual(levelBody.providerOptions, {
		google: {
			thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
		},
		vertex: {
			thinkingConfig: { thinkingLevel: "high", includeThoughts: true },
		},
	});

	const budgetRequest = vercelAdapter.chat!.buildRequest(
		{ ...baseRequest, reasoning: { effort: "none" } },
		ctxWithReasoning("google/gemini-2.5-flash", "chat_completions", {
			kind: "gemini_budget",
			levels: ["none", "high"],
			budgets: { high: 24_576 },
		}),
	);
	const budgetBody = JSON.parse(budgetRequest.body!);
	assert.equal(budgetBody.reasoning, undefined);
	assert.deepEqual(budgetBody.providerOptions, {
		google: {
			thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
		},
		vertex: {
			thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
		},
	});
});

test("vercel preserves explicit Anthropic token budgets across provider fallbacks", () => {
	const request = vercelAdapter.chat!.buildRequest(
		{ ...baseRequest, reasoning: { effort: "high" } },
		ctxWithReasoning("anthropic/claude-sonnet-4.5", "responses", {
			kind: "anthropic_budget",
			levels: ["none", "high"],
			budgets: { high: 16_000 },
		}),
	);
	const body = JSON.parse(request.body!);
	assert.equal(body.reasoning, undefined);
	assert.deepEqual(body.providerOptions, {
		anthropic: {
			thinking: { type: "enabled", budgetTokens: 16_000 },
		},
		bedrock: {
			reasoningConfig: { type: "enabled", budgetTokens: 16_000 },
		},
	});
});

test("vercel rejects collisions with adapter-managed provider reasoning", () => {
	assert.throws(
		() =>
			vercelAdapter.chat!.buildRequest(
				{
					...baseRequest,
					reasoning: { effort: "max" },
					extraBody: {
						providerOptions: {
							anthropic: { effort: "low" },
						},
					},
				},
				ctxWithReasoning("anthropic/claude-opus-5", "responses", {
					kind: "anthropic_adaptive",
					levels: ["none", "low", "medium", "high", "xhigh", "max"],
				}),
			),
		(error: unknown) =>
			error instanceof Error &&
			error.message.includes(
				"extra_body.providerOptions.anthropic.effort collides",
			),
	);
});

test("vercel Chat replays and parses provider-normalized reasoning details", () => {
	const details = [
		{
			type: "reasoning.text",
			text: "plan",
			signature: "sig_1",
			format: "anthropic-claude-v1",
		},
	];
	const request = vercelAdapter.chat!.buildRequest(
		{
			...baseRequest,
			messages: [
				{
					role: "assistant",
					content: "I will use a tool.",
					providerFields: {
						vercel: { reasoning_details: details },
					},
				},
				{ role: "user", content: "continue" },
			],
		},
		ctx("anthropic/claude-opus-5", "chat_completions"),
	);
	const body = JSON.parse(request.body!);
	assert.deepEqual(body.messages[0].reasoning_details, details);

	const response = vercelAdapter.chat!.parseResponse(
		{
			id: "chatcmpl_1",
			created: 1,
			model: "anthropic/claude-opus-5",
			choices: [
				{
					index: 0,
					finish_reason: "stop",
					message: {
						role: "assistant",
						content: "done",
						reasoning: "plan",
						reasoning_details: details,
					},
				},
			],
			usage: {
				prompt_tokens: 2,
				completion_tokens: 3,
				total_tokens: 5,
			},
		},
		ctx("anthropic/claude-opus-5", "chat_completions"),
	);
	assert.deepEqual(response.choices[0]!.message.providerFields, {
		vercel: { reasoning_details: details },
	});
});

test("vercel Chat preserves streamed reasoning details", async () => {
	const raw = {
		id: "chatcmpl_1",
		created: 1,
		model: "openai/gpt-5.6-sol",
		choices: [
			{
				index: 0,
				finish_reason: null,
				delta: {
					reasoning: "step",
					reasoning_details: [
						{
							type: "reasoning.summary",
							summary: "step",
							format: "openai-responses-v1",
							index: 0,
						},
					],
				},
			},
		],
	};
	const stream = new Response(
		`data: ${JSON.stringify(raw)}\n\ndata: [DONE]\n\n`,
	).body!;
	const chunks = [];
	for await (const chunk of vercelAdapter.chat!.parseStream(
		stream,
		ctx("openai/gpt-5.6-sol", "chat_completions"),
	)) {
		chunks.push(chunk);
	}
	assert.equal(chunks[0]?.choices[0]?.delta.reasoning, "step");
	assert.deepEqual(chunks[0]?.choices[0]?.delta.providerFields, {
		vercel: {
			reasoning_details: raw.choices[0]!.delta.reasoning_details,
		},
	});
});

test("vercel uses its OpenAI-compatible embeddings and images endpoints", async () => {
	const embeddings = vercelAdapter.embeddings!.buildRequest(
		{
			model: "public-embedding",
			input: "hello",
			encodingFormat: "float",
			dimensions: 256,
		},
		ctx("openai/text-embedding-3-small", "embeddings"),
	);
	assert.equal(embeddings.url, "https://ai-gateway.vercel.sh/v1/embeddings");
	assert.deepEqual(JSON.parse(embeddings.body!), {
		model: "openai/text-embedding-3-small",
		input: "hello",
		encoding_format: "float",
		dimensions: 256,
	});

	const image = await vercelAdapter.imageGeneration!.buildRequest(
		{
			operation: "generation",
			model: "public-image",
			prompt: "draw a lighthouse",
			stream: false,
		},
		ctx("openai/gpt-image-2", "images"),
	);
	assert.equal(image.url, "https://ai-gateway.vercel.sh/v1/images/generations");
	assert.equal(JSON.parse(image.body as string).model, "openai/gpt-image-2");
});
