import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { openaicompatibleAdapter } from "./index.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const req: CanonicalChatRequest = {
	callType: "chat",
	model: "grok",
	messages: [{ role: "user", content: "hi" }],
	stream: false,
	maxTokens: 128,
};

function ctx(creds: Record<string, unknown>): AdapterContext {
	return {
		upstreamModel: "grok-2",
		credentials: creds,
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
}

function reasoningCtx(creds: Record<string, unknown>): AdapterContext {
	return {
		...ctx(creds),
		meta: {
			capabilities: {
				tools: true,
				vision: true,
				reasoning: true,
				structuredOutputs: false,
			},
			reasoning: {
				kind: "openai_effort",
				levels: ["none", "minimal", "low", "medium", "high"],
			},
		},
	};
}

test("compatible supports chat (and responses by render)", () => {
	assert.ok(openaicompatibleAdapter.supportedCallTypes.has("chat"));
});

test("compatible: baseUrl is required", () => {
	try {
		openaicompatibleAdapter.chat!.buildRequest(req, ctx({ apiKey: "k" }));
		assert.fail("should have thrown");
	} catch (err) {
		assert.ok(GatewayError.is(err));
		assert.match((err as GatewayError).message, /baseUrl/);
	}
});

test("compatible: uses max_tokens and the given baseUrl", () => {
	const r = openaicompatibleAdapter.chat!.buildRequest(
		req,
		ctx({ apiKey: "xai-key", baseUrl: "https://api.x.ai/v1" }),
	);
	assert.equal(r.url, "https://api.x.ai/v1/chat/completions");
	assert.equal(r.headers.authorization, "Bearer xai-key");
	const body = JSON.parse(r.body!);
	assert.equal(body.max_tokens, 128);
	assert.equal(body.max_completion_tokens, undefined);
	assert.equal(body.model, "grok-2");
});

test("compatible: canonical format is emitted as chat response_format", () => {
	const schema = { type: "object", properties: { answer: { type: "string" } } };
	const r = openaicompatibleAdapter.chat!.buildRequest(
		{
			...req,
			responseFormat: {
				type: "json_schema",
				name: "answer",
				schema,
				strict: true,
			},
		},
		ctx({ apiKey: "xai-key", baseUrl: "https://api.x.ai/v1" }),
	);
	assert.deepEqual(JSON.parse(r.body!).response_format, {
		type: "json_schema",
		json_schema: { name: "answer", schema, strict: true },
	});
});

test("compatible: streaming ALWAYS requests usage upstream (for accounting)", () => {
	// The client did NOT request include_usage, but we must still request it upstream.
	const streamReq: CanonicalChatRequest = { ...req, stream: true };
	const r = openaicompatibleAdapter.chat!.buildRequest(
		streamReq,
		ctx({ apiKey: "k", baseUrl: "https://api.x.ai/v1" }),
	);
	const body = JSON.parse(r.body!);
	assert.equal(body.stream, true);
	assert.equal(body.stream_options?.include_usage, true);
});

test("compatible: emits reasoning_effort and merges extraBody in chat transport", () => {
	const r = openaicompatibleAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "xhigh" }, extraBody: { top_k: 40 } },
		reasoningCtx({ apiKey: "k", baseUrl: "https://api.x.ai/v1" }),
	);
	const body = JSON.parse(r.body!);
	assert.equal(body.reasoning_effort, "high");
	assert.equal(body.top_k, 40);
});

function chatTemplateFlagCtx(creds: Record<string, unknown>): AdapterContext {
	return {
		...ctx(creds),
		meta: {
			capabilities: {
				tools: true,
				vision: true,
				reasoning: true,
				structuredOutputs: false,
			},
			reasoning: {
				kind: "chat_template_flag",
				levels: ["none", "high"],
				chatTemplateFlag: { param: "thinking" },
			},
		},
	};
}

function openAIBodyReasoningCtx(
	creds: Record<string, unknown>,
): AdapterContext {
	return {
		...ctx(creds),
		meta: {
			capabilities: {
				tools: true,
				vision: false,
				reasoning: true,
				structuredOutputs: true,
			},
			reasoning: {
				kind: "openai_body",
				levels: ["none", "high", "max"],
				bodyField: {
					param: "thinking",
					onValue: { type: "enabled" },
					offValue: { type: "disabled" },
				},
				effortField: "reasoning_effort",
			},
		},
	};
}

test("compatible: chat_template_flag injects the toggle into chat_template_kwargs and does NOT use reasoning_effort", () => {
	const r = openaicompatibleAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "high" } },
		chatTemplateFlagCtx({
			apiKey: "k",
			baseUrl: "https://integrate.api.nvidia.com/v1",
		}),
	);
	const body = JSON.parse(r.body!);
	assert.deepEqual(body.chat_template_kwargs, { thinking: true });
	assert.equal(body.reasoning_effort, undefined);
});

test("compatible: openai_body injects top-level thinking and optional effort", () => {
	const off = openaicompatibleAdapter.chat!.buildRequest(
		{ ...req, extraBody: { thinking: { type: "enabled" }, top_k: 40 } },
		openAIBodyReasoningCtx({
			apiKey: "k",
			baseUrl: "https://api.example.test/v1",
		}),
	);
	let body = JSON.parse(off.body!);
	assert.deepEqual(body.thinking, { type: "disabled" });
	assert.equal(body.reasoning_effort, undefined);
	assert.equal(body.top_k, 40);

	const on = openaicompatibleAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "xhigh" } },
		openAIBodyReasoningCtx({
			apiKey: "k",
			baseUrl: "https://api.example.test/v1",
		}),
	);
	body = JSON.parse(on.body!);
	assert.deepEqual(body.thinking, { type: "enabled" });
	assert.equal(body.reasoning_effort, "high");

	const maximum = openaicompatibleAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "max" } },
		openAIBodyReasoningCtx({
			apiKey: "k",
			baseUrl: "https://api.example.test/v1",
		}),
	);
	body = JSON.parse(maximum.body!);
	assert.deepEqual(body.thinking, { type: "enabled" });
	assert.equal(body.reasoning_effort, "max");
});

test("compatible: chat_template_flag off by default and preserves other extra_body keys", () => {
	const r = openaicompatibleAdapter.chat!.buildRequest(
		// no reasoning -> off (does not emit thinking); the client passes other chat_template_kwargs.
		{ ...req, extraBody: { chat_template_kwargs: { foo: 1 } } },
		chatTemplateFlagCtx({
			apiKey: "k",
			baseUrl: "https://integrate.api.nvidia.com/v1",
		}),
	);
	const body = JSON.parse(r.body!);
	assert.deepEqual(body.chat_template_kwargs, { foo: 1 });
});

test("compatible: chat_template_flag wins over the client toggle but keeps the rest", () => {
	const r = openaicompatibleAdapter.chat!.buildRequest(
		{
			...req,
			reasoning: { effort: "high" },
			extraBody: { chat_template_kwargs: { thinking: false, foo: 1 } },
		},
		chatTemplateFlagCtx({
			apiKey: "k",
			baseUrl: "https://integrate.api.nvidia.com/v1",
		}),
	);
	const body = JSON.parse(r.body!);
	assert.deepEqual(body.chat_template_kwargs, { thinking: true, foo: 1 });
});

test("compatible: extraBody does not overwrite managed fields", () => {
	assert.throws(
		() =>
			openaicompatibleAdapter.chat!.buildRequest(
				{ ...req, extraBody: { temperature: 0.2 } },
				reasoningCtx({ apiKey: "k", baseUrl: "https://api.x.ai/v1" }),
			),
		/extra_body.temperature/,
	);
});
