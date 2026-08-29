import { assertTextRequestSupported } from "#gateway/textRequestValidation.ts";
import { resolveModelMetadata, getCatalogEntry } from "#catalog/index.ts";
import { openaicompatibleAdapter } from "./openaicompatible/index.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { Adapter, AdapterContext } from "./types.ts";
import { deepseekAdapter } from "./deepseek/index.ts";
import { moonshotAdapter } from "./moonshot/index.ts";
import { minimaxAdapter } from "./minimax/index.ts";
import { zaiAdapter } from "./zai/index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const req: CanonicalChatRequest = {
	callType: "chat",
	model: "m",
	messages: [{ role: "user", content: "hello" }],
	stream: false,
	maxTokens: 64,
};

function ctx(
	upstreamModel: string,
	adapterKey: string,
	creds: Record<string, unknown>,
): AdapterContext {
	return {
		upstreamModel,
		credentials: creds,
		meta: resolveModelMetadata(adapterKey, upstreamModel),
		transport: "chat_completions",
		requestId: "t",
	};
}

test("new providers: default base URL, max_tokens, and auth", () => {
	const cases: Array<[Adapter, string, string]> = [
		[
			deepseekAdapter,
			"deepseek-chat",
			"https://api.deepseek.com/v1/chat/completions",
		],
		[
			moonshotAdapter,
			"kimi-k2.6",
			"https://api.moonshot.ai/v1/chat/completions",
		],
		[zaiAdapter, "glm-4.6", "https://api.z.ai/api/paas/v4/chat/completions"],
		[
			minimaxAdapter,
			"MiniMax-M2",
			"https://api.minimax.io/v1/chat/completions",
		],
	];
	for (const [adapter, model, expectedUrl] of cases) {
		const r = adapter.chat!.buildRequest(
			req,
			ctx(model, adapter.key, { apiKey: "k" }),
		);
		assert.equal(r.url, expectedUrl, adapter.key);
		assert.equal(r.headers.authorization, "Bearer k");
		const body = JSON.parse(r.body!);
		assert.equal(body.max_tokens, 64, adapter.key);
		assert.equal(body.max_completion_tokens, undefined, adapter.key);
		assert.equal(body.model, model);
	}
});

test("compatible providers downgrade developer and forward catalog top_k", () => {
	for (const [adapter, model] of [
		[deepseekAdapter, "deepseek-r1"],
		[moonshotAdapter, "kimi-k2"],
		[zaiAdapter, "glm-4.6"],
		[minimaxAdapter, "MiniMax-M2"],
		[openaicompatibleAdapter, "custom-model"],
	] as const) {
		const built = adapter.chat!.buildRequest(
			{
				...req,
				topK: 32,
				messages: [{ role: "developer", content: "instructions" }],
			},
			ctx(model, adapter.key, {
				apiKey: "k",
				...(adapter === openaicompatibleAdapter
					? { baseUrl: "https://compatible.example/v1" }
					: {}),
			}),
		);
		const body = JSON.parse(built.body!);
		assert.equal(body.messages[0].role, "system", adapter.key);
		assert.equal(body.top_k, 32, adapter.key);
	}
});

test("chat-compatible providers advertise only transports they implement", () => {
	assert.deepEqual(deepseekAdapter.transports?.chat, {
		supported: ["chat_completions", "responses"],
		default: "chat_completions",
	});
	for (const adapter of [
		moonshotAdapter,
		zaiAdapter,
		minimaxAdapter,
		openaicompatibleAdapter,
	]) {
		assert.deepEqual(adapter.transports?.chat, {
			supported: ["chat_completions"],
			default: "chat_completions",
		});
	}
});

test("OpenAI-style transports declare portable image source capabilities", () => {
	for (const adapter of [
		deepseekAdapter,
		moonshotAdapter,
		zaiAdapter,
		minimaxAdapter,
		openaicompatibleAdapter,
	]) {
		assert.deepEqual(adapter.contentInputs?.chat_completions?.image, {
			sources: ["url", "data_url"],
		});
	}
});

test("catalog: current models for each provider exist with their limits", () => {
	assert.ok(getCatalogEntry("deepseek", "deepseek-v4-flash"));
	assert.ok(getCatalogEntry("moonshot", "kimi-k3"));
	assert.ok(getCatalogEntry("moonshot", "kimi-k2.7-code"));
	assert.ok(getCatalogEntry("zai", "glm-5.2"));
	assert.ok(getCatalogEntry("minimax", "MiniMax-M3"));

	const m3 = resolveModelMetadata("minimax", "MiniMax-M3");
	assert.equal(m3.maxInputTokens, 1_000_000);
	assert.equal(m3.capabilities.reasoning, true);
	assert.equal(m3.capabilities.vision, true);
});

test("catalog: DeepSeek-V4 includes official pricing and native thinking/effort", () => {
	const flash = resolveModelMetadata("deepseek", "deepseek-v4-flash");
	const pro = resolveModelMetadata("deepseek", "deepseek-v4-pro");
	assert.equal(flash.pricing?.inputCentsPerMTokens, 14);
	assert.equal(flash.pricing?.cacheReadCentsPerMTokens, 0.28);
	assert.equal(flash.pricing?.outputCentsPerMTokens, 28);
	assert.equal(flash.maxOutputTokens, 384000);
	assert.equal(flash.capabilities.structuredOutputs, true);
	assert.equal(flash.capabilities.strictTools, true);
	assert.equal(flash.reasoning?.kind, "openai_body");
	assert.deepEqual(
		flash.reasoning,
		pro.reasoning,
		"DeepSeek V4 Flash and Pro share effort levels",
	);

	// "none" ∈ levels: omitting effort -> the gateway explicitly disables thinking.
	const r = deepseekAdapter.chat!.buildRequest(
		req,
		ctx("deepseek-v4-flash", "deepseek", { apiKey: "k" }),
	);
	let body = JSON.parse(r.body!);
	assert.deepEqual(body.thinking, { type: "disabled" });
	assert.equal(body.reasoning_effort, undefined);

	const extended = deepseekAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "xhigh" } },
		ctx("deepseek-v4-flash", "deepseek", { apiKey: "k" }),
	);
	body = JSON.parse(extended.body!);
	assert.deepEqual(body.thinking, { type: "enabled" });
	assert.equal(body.reasoning_effort, "high");

	const strongest = deepseekAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "max" } },
		ctx("deepseek-v4-flash", "deepseek", { apiKey: "k" }),
	);
	body = JSON.parse(strongest.body!);
	assert.equal(body.reasoning_effort, "max");
});

test("DeepSeek strict tools use the beta Chat endpoint and require all tools strict", () => {
	const strictRequest: CanonicalChatRequest = {
		...req,
		tools: [
			{
				name: "lookup",
				strict: true,
				parameters: {
					type: "object",
					properties: { id: { type: "string" } },
					required: ["id"],
					additionalProperties: false,
				},
			},
		],
	};
	const built = deepseekAdapter.chat!.buildRequest(
		strictRequest,
		ctx("deepseek-v4-flash", "deepseek", { apiKey: "k" }),
	);
	assert.equal(built.url, "https://api.deepseek.com/beta/chat/completions");
	assert.equal(JSON.parse(built.body!).tools[0].function.strict, true);

	assert.throws(() =>
		deepseekAdapter.chat!.buildRequest(
			{
				...strictRequest,
				tools: [strictRequest.tools![0]!, { name: "other", strict: false }],
			},
			ctx("deepseek-v4-flash", "deepseek", { apiKey: "k" }),
		),
	);
});

test("DeepSeek maps reasoning onto the Responses contract, not its Chat body fields", () => {
	// DeepSeek's Responses API supports `reasoning.effort` and silently ignores unknown top-level
	// keys, so the native Chat controls (`thinking`, `reasoning_effort`) must not leak onto it.
	const responsesCtx = {
		...ctx("deepseek-v4-flash", "deepseek", { apiKey: "k" }),
		transport: "responses" as const,
	};
	const off = JSON.parse(
		deepseekAdapter.chat!.buildRequest(req, responsesCtx).body!,
	);
	assert.deepEqual(off.reasoning, { effort: "none" });
	assert.equal(off.thinking, undefined);
	assert.equal(off.reasoning_effort, undefined);

	const on = JSON.parse(
		deepseekAdapter.chat!.buildRequest(
			{ ...req, reasoning: { effort: "xhigh" } },
			responsesCtx,
		).body!,
	);
	assert.deepEqual(on.reasoning, { effort: "high", summary: "auto" });
	assert.equal(on.thinking, undefined);
	assert.equal(on.reasoning_effort, undefined);
});

test("DeepSeek strict output uses the native Responses schema", () => {
	const built = deepseekAdapter.chat!.buildRequest(
		{
			...req,
			tools: [
				{ name: "lookup", strict: false, parameters: { type: "object" } },
			],
			responseFormat: {
				type: "json_schema",
				name: "answer",
				schema: { type: "object", additionalProperties: false },
				strict: true,
			},
		},
		{
			...ctx("deepseek-v4-flash", "deepseek", { apiKey: "k" }),
			transport: "responses",
		},
	);
	const body = JSON.parse(built.body!);
	assert.equal(built.url, "https://api.deepseek.com/responses");
	assert.deepEqual(body.text.format, {
		type: "json_schema",
		name: "answer",
		schema: { type: "object", additionalProperties: false },
	});
	assert.equal(body.tools[0].strict, undefined);
});

test("Moonshot emits its native strict function-tool flag", () => {
	const built = moonshotAdapter.chat!.buildRequest(
		{
			...req,
			tools: [{ name: "lookup", strict: true, parameters: { type: "object" } }],
		},
		ctx("kimi-k2.6", "moonshot", { apiKey: "k" }),
	);
	assert.equal(JSON.parse(built.body!).tools[0].function.strict, true);
});

test("Z.AI does not claim strict JSON Schema support", () => {
	const metadata = resolveModelMetadata("zai", "glm-5.2");
	assert.equal(metadata.capabilities.structuredOutputs, false);
	assert.throws(() =>
		assertTextRequestSupported(
			{
				...req,
				responseFormat: {
					type: "json_schema",
					schema: { type: "object" },
					strict: true,
				},
			},
			metadata,
		),
	);
});

test("catalog: GLM-5.2 keeps xhigh distinct from native max", () => {
	const glm = resolveModelMetadata("zai", "glm-5.2");
	assert.equal(glm.maxInputTokens, 1_000_000);
	assert.equal(glm.capabilities.structuredOutputs, false);
	assert.equal(glm.reasoning?.kind, "openai_body");
	const r = zaiAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "xhigh" } },
		ctx("glm-5.2", "zai", { apiKey: "k" }),
	);
	const body = JSON.parse(r.body!);
	assert.deepEqual(body.thinking, { type: "enabled" });
	assert.equal(body.reasoning_effort, "high");

	const maximum = zaiAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "max" } },
		ctx("glm-5.2", "zai", { apiKey: "k" }),
	);
	const maximumBody = JSON.parse(maximum.body!);
	assert.deepEqual(maximumBody.thinking, { type: "enabled" });
	assert.equal(maximumBody.reasoning_effort, "max");
});

test("catalog: GLM-5.3 enforces its mandatory reasoning floor", () => {
	const glm = resolveModelMetadata("zai", "glm-5.3");
	assert.equal(glm.maxInputTokens, 1_000_000);
	assert.equal(glm.maxOutputTokens, 131_072);
	assert.equal(glm.capabilities.structuredOutputs, false);
	assert.deepEqual(glm.reasoning, {
		kind: "openai_body",
		levels: ["low", "high", "max"],
		bodyField: {
			param: "thinking",
			onValue: { type: "enabled" },
		},
		effortField: "reasoning_effort",
	});

	const defaultRequest = zaiAdapter.chat!.buildRequest(
		req,
		ctx("glm-5.3", "zai", { apiKey: "k" }),
	);
	const defaultBody = JSON.parse(defaultRequest.body!);
	assert.deepEqual(defaultBody.thinking, { type: "enabled" });
	assert.equal(defaultBody.reasoning_effort, "low");

	const extended = zaiAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "xhigh" } },
		ctx("glm-5.3", "zai", { apiKey: "k" }),
	);
	const extendedBody = JSON.parse(extended.body!);
	assert.equal(extendedBody.reasoning_effort, "high");
});

test("catalog: Kimi K3 and K2.x model-native thinking", () => {
	const k3 = resolveModelMetadata("moonshot", "kimi-k3");
	const k26 = resolveModelMetadata("moonshot", "kimi-k2.6");
	const k27 = resolveModelMetadata("moonshot", "kimi-k2.7-code");
	assert.equal(k3.maxInputTokens, 1_048_576);
	assert.equal(k3.maxOutputTokens, 1_048_576);
	assert.equal(k3.pricing?.inputCentsPerMTokens, 300);
	assert.deepEqual(k3.reasoning, {
		kind: "openai_effort",
		levels: ["max"],
	});
	assert.equal(k26.capabilities.structuredOutputs, true);
	assert.equal(k26.maxOutputTokens, 262144);
	assert.equal(k26.reasoning?.kind, "openai_body");
	assert.equal(k27.reasoning?.kind, "fixed");
	assert.equal(k27.reasoning?.levels.includes("none"), false);

	const off = moonshotAdapter.chat!.buildRequest(
		req,
		ctx("kimi-k2.6", "moonshot", { apiKey: "k" }),
	);
	assert.deepEqual(JSON.parse(off.body!).thinking, { type: "disabled" });
	const on = moonshotAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "high" } },
		ctx("kimi-k2.6", "moonshot", { apiKey: "k" }),
	);
	assert.deepEqual(JSON.parse(on.body!).thinking, { type: "enabled" });

	const k3Request = moonshotAdapter.chat!.buildRequest(
		req,
		ctx("kimi-k3", "moonshot", { apiKey: "k" }),
	);
	const k3Body = JSON.parse(k3Request.body!);
	assert.equal(k3Body.thinking, undefined);
	assert.equal(k3Body.reasoning_effort, "max");
});

test("deprecated DeepSeek aliases preserve compatibility modes", () => {
	const reasoner = resolveModelMetadata("deepseek", "deepseek-reasoner");
	assert.equal(reasoner.capabilities.reasoning, true);
	assert.equal(reasoner.reasoning?.kind, "fixed");

	// No explicit effort: no control is emitted; the alias selects the upstream thinking mode.
	const r = deepseekAdapter.chat!.buildRequest(
		req,
		ctx("deepseek-reasoner", "deepseek", { apiKey: "k" }),
	);
	assert.equal(JSON.parse(r.body!).reasoning_effort, undefined);

	// Clamp-don't-reject: a fixed reasoner accepts any effort (including "none"); it always reasons and
	// emits no upstream control regardless.
	for (const effort of ["high", "none", "low"] as const) {
		assert.doesNotThrow(() =>
			assertTextRequestSupported({ ...req, reasoning: { effort } }, reasoner),
		);
	}
});

test("new providers: context overflow 400 -> context_window (by message)", () => {
	const err = {
		status: 400,
		body: {
			error: {
				message: "This model's maximum context length is 131072 tokens.",
			},
		},
	};
	for (const adapter of [
		deepseekAdapter,
		moonshotAdapter,
		zaiAdapter,
		minimaxAdapter,
	]) {
		const ge = adapter.chat!.mapError(
			err,
			ctx("m", adapter.key, { apiKey: "k" }),
		);
		assert.equal(ge.class, "context_window", adapter.key);
	}
});
