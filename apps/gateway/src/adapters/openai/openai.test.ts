import type { CanonicalEmbeddingsRequest } from "#core/embeddings.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { GatewayError } from "#core/errors.ts";
import { openaiAdapter } from "./index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	openaiResponsesStreamOutputFromProviderFields,
	openaiResponsesStreamEventFromProviderFields,
	openaiReasoningItemIdFromProviderFields,
	openaiReasoningFromProviderFields,
} from "#core/providerSpecificFields.ts";

const ctx: AdapterContext = {
	upstreamModel: "gpt-5.5",
	credentials: { apiKey: "sk-test", organization: "org_1" },
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: false,
			structuredOutputs: true,
		},
	},
	transport: "responses",
	requestId: "t",
};

const reasoningCtx: AdapterContext = {
	...ctx,
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
		reasoning: {
			kind: "openai_effort",
			levels: ["none", "low", "medium", "high"],
		},
	},
};

const baseReq: CanonicalChatRequest = {
	callType: "chat",
	model: "gpt",
	messages: [{ role: "user", content: "hello" }],
	stream: false,
	temperature: 0.7,
	maxTokens: 100,
};

const embeddingsCtx: AdapterContext = {
	...ctx,
	upstreamModel: "text-embedding-3-small",
	transport: "embeddings",
	meta: {
		...ctx.meta,
		operations: {
			"embedding.create": {
				dimensions: 1536,
				supportsDimensions: true,
				encodingFormats: ["float", "base64"],
			},
		},
	},
};

const embeddingsReq: CanonicalEmbeddingsRequest = {
	model: "emb",
	input: ["hello", "world"],
	encodingFormat: "float",
	dimensions: 256,
	user: "user-1",
};

test("openai.buildRequest: native /responses transport, auth, and responses body", () => {
	const r = openaiAdapter.chat!.buildRequest(baseReq, ctx);
	assert.equal(r.method, "POST");
	assert.equal(r.url, "https://api.openai.com/v1/responses"); // transport upstream = /responses
	assert.equal(r.headers.authorization, "Bearer sk-test");
	assert.equal(r.headers["openai-organization"], "org_1");
	const body = JSON.parse(r.body!);
	assert.equal(body.model, "gpt-5.5");
	assert.equal(body.max_output_tokens, 100);
	assert.equal(body.input[0].content[0].text, "hello");
});

test("openai.buildRequest: does not forward provider-specific tool-call extra_content", () => {
	const r = openaiAdapter.chat!.buildRequest(
		{
			...baseReq,
			messages: [
				{
					role: "assistant",
					content: null,
					toolCalls: [
						{
							id: "call_1",
							name: "f",
							arguments: "{}",
							extraContent: {
								google: { thought_signature: "sig-a" },
							},
						},
					],
				},
			],
		},
		ctx,
	);
	const body = JSON.parse(r.body!);
	assert.equal(body.input[0].extra_content, undefined);
});

test("openai.buildRequest: forwards /responses transport options", () => {
	const r = openaiAdapter.chat!.buildRequest(
		{
			...baseReq,
			responsesTransport: {
				include: ["message.output_text.logprobs"],
				metadata: { trace: "abc" },
				text: { format: { type: "text" } },
				reasoning: { effort: "low" },
				streamOptions: { include_usage: true },
				serviceTier: "flex",
				safetyIdentifier: "user-1",
				promptCacheKey: "thread-1",
				topLogprobs: 2,
				maxToolCalls: 4,
			},
		},
		ctx,
	);
	const body = JSON.parse(r.body!);
	assert.deepEqual(body.include, ["message.output_text.logprobs"]);
	assert.deepEqual(body.metadata, { trace: "abc" });
	assert.deepEqual(body.text, { format: { type: "text" } });
	assert.deepEqual(body.reasoning, { effort: "low" });
	assert.deepEqual(body.stream_options, { include_usage: true });
	assert.equal(body.service_tier, "flex");
	assert.equal(body.safety_identifier, "user-1");
	assert.equal(body.prompt_cache_key, "thread-1");
	assert.equal(body.top_logprobs, 2);
	assert.equal(body.max_tool_calls, 4);
});

test("openai.buildRequest: canonical format is emitted as /responses text.format", () => {
	const schema = {
		type: "object",
		properties: { answer: { type: "string" } },
		required: ["answer"],
	};
	const r = openaiAdapter.chat!.buildRequest(
		{
			...baseReq,
			responseFormat: {
				type: "json_schema",
				schema,
				description: "Answer",
				strict: true,
			},
			responsesTransport: { text: { verbosity: "low" } },
		},
		ctx,
	);
	assert.deepEqual(JSON.parse(r.body!).text, {
		verbosity: "low",
		format: {
			type: "json_schema",
			name: "structured_output",
			description: "Answer",
			schema,
			strict: true,
		},
	});
});

test("openai.buildRequest: omitted effort on model that can skip reasoning -> effort none (without summary)", () => {
	// reasoningCtx has "none" ∈ levels: the gateway default is NOT to reason.
	const r = openaiAdapter.chat!.buildRequest(baseReq, reasoningCtx);
	assert.deepEqual(JSON.parse(r.body!).reasoning, { effort: "none" });
});

test("openai.buildRequest: omitted effort on MANDATORY reasoner -> lowest level + auto summary", () => {
	const forcedCtx: AdapterContext = {
		...ctx,
		meta: {
			capabilities: {
				tools: true,
				vision: true,
				reasoning: true,
				structuredOutputs: true,
			},
			reasoning: {
				kind: "openai_effort",
				levels: ["low", "medium", "high"],
			},
		},
	};
	const r = openaiAdapter.chat!.buildRequest(baseReq, forcedCtx);
	assert.deepEqual(JSON.parse(r.body!).reasoning, {
		effort: "low",
		summary: "auto",
	});
});

test("openai.buildRequest: canonical reasoning is clamped and merged with summary", () => {
	const r = openaiAdapter.chat!.buildRequest(
		{
			...baseReq,
			reasoning: { effort: "xhigh" },
			responsesTransport: { reasoning: { summary: "auto" } },
			extraBody: { custom_param: true },
		},
		reasoningCtx,
	);
	const body = JSON.parse(r.body!);
	assert.deepEqual(body.reasoning, { summary: "auto", effort: "high" });
	assert.equal(body.custom_param, true);
});

test("openai.buildRequest: preserves distinct xhigh and max efforts", () => {
	const fullCtx: AdapterContext = {
		...reasoningCtx,
		meta: {
			...reasoningCtx.meta,
			reasoning: {
				kind: "openai_effort",
				levels: ["none", "high", "xhigh", "max"],
			},
		},
	};
	const extended = openaiAdapter.chat!.buildRequest(
		{ ...baseReq, reasoning: { effort: "xhigh" } },
		fullCtx,
	);
	assert.deepEqual(JSON.parse(extended.body!).reasoning, {
		effort: "xhigh",
		summary: "auto",
	});

	const maximum = openaiAdapter.chat!.buildRequest(
		{ ...baseReq, reasoning: { effort: "max" } },
		fullCtx,
	);
	assert.deepEqual(JSON.parse(maximum.body!).reasoning, {
		effort: "max",
		summary: "auto",
	});
});

test("openai.buildRequest: extraBody does not overwrite managed fields", () => {
	assert.throws(
		() =>
			openaiAdapter.chat!.buildRequest(
				{ ...baseReq, extraBody: { reasoning: { effort: "low" } } },
				reasoningCtx,
			),
		/extra_body.reasoning/,
	);
});

test("openai.parseResponse: /responses output -> canonical", () => {
	const raw = {
		id: "resp_1",
		created_at: 1700000000,
		model: "gpt-5.5",
		status: "completed",
		output: [
			{
				type: "reasoning",
				summary: [{ type: "summary_text", text: "Penbe brief." }],
			},
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "hello!" }],
			},
		],
		usage: {
			input_tokens: 10,
			output_tokens: 3,
			total_tokens: 13,
			input_tokens_details: { cached_tokens: 2 },
		},
	};
	const u = openaiAdapter.chat!.parseResponse(raw, ctx);
	assert.equal(u.choices[0]!.message.content, "hello!");
	assert.equal(u.choices[0]!.message.reasoning, "Penbe brief.");
	assert.equal(u.choices[0]!.finishReason, "stop");
	assert.equal(u.usage.totalTokens, 13);
	assert.equal(u.usage.cacheReadTokens, 2);
});

test("openai.parseResponse: function_call -> tool_calls", () => {
	const raw = {
		id: "resp_2",
		status: "completed",
		output: [
			{ type: "function_call", call_id: "call_1", name: "f", arguments: "{}" },
		],
		usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
	};
	const u = openaiAdapter.chat!.parseResponse(raw, ctx);
	assert.equal(u.choices[0]!.finishReason, "tool_calls");
	assert.equal(u.choices[0]!.message.toolCalls?.[0]?.name, "f");
});

test("openai.parseStream: response.* events -> canonical deltas", async () => {
	const sse =
		`event: response.created\ndata: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.5"}}\n\n` +
		`event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hel"}\n\n` +
		`event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n` +
		`event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":2,"total_tokens":3}}}\n\n`;
	const stream = new Response(sse).body!;
	const out: string[] = [];
	let lastFinish: string | null = null;
	let total: number | undefined;
	for await (const chunk of openaiAdapter.chat!.parseStream(stream, ctx)) {
		if (chunk.choices[0]?.delta.content)
			out.push(chunk.choices[0].delta.content);
		if (chunk.choices[0]?.finishReason)
			lastFinish = chunk.choices[0].finishReason;
		if (chunk.usage) total = chunk.usage.totalTokens;
	}
	assert.equal(out.join(""), "Hello");
	assert.equal(lastFinish, "stop");
	assert.equal(total, 3);
});

test("openai.parseStream: reasoning summary deltas preserve their native item id", async () => {
	const sse =
		`event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","item_id":"rs_native","delta":"Think"}\n\n` +
		`event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"reasoning","id":"rs_native","summary":[{"type":"summary_text","text":"Think"}],"encrypted_content":"enc-native"}}\n\n` +
		`event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n`;
	const chunks = [];
	for await (const chunk of openaiAdapter.chat!.parseStream(
		new Response(sse).body!,
		ctx,
	))
		chunks.push(chunk);

	assert.equal(chunks[0]!.choices[0]!.delta.reasoning, "Think");
	const summaryFields = chunks[0]!.choices[0]!.delta.providerFields;
	assert.equal(
		openaiReasoningItemIdFromProviderFields(summaryFields),
		"rs_native",
	);
	assert.deepEqual(
		openaiResponsesStreamEventFromProviderFields(summaryFields),
		{
			type: "response.reasoning_summary_text.delta",
			data: { item_id: "rs_native", delta: "Think" },
		},
	);
	const doneFields = chunks[1]!.choices[0]!.delta.providerFields;
	assert.deepEqual(openaiReasoningFromProviderFields(doneFields), [
		{
			encrypted_content: "enc-native",
			id: "rs_native",
			summary: [{ type: "summary_text", text: "Think" }],
		},
	]);
	assert.equal(
		openaiResponsesStreamEventFromProviderFields(doneFields)?.type,
		"response.output_item.done",
	);
});

test("openai.mapError: 429 -> rate_limit; 400 context_length_exceeded -> context_window", () => {
	const rl = openaiAdapter.chat!.mapError(
		{ status: 429, body: { error: { message: "slow" } } },
		ctx,
	);
	assert.equal(rl.class, "rate_limit");
	const ctxErr = openaiAdapter.chat!.mapError(
		{
			status: 400,
			body: { error: { code: "context_length_exceeded", message: "too long" } },
		},
		ctx,
	);
	assert.equal(ctxErr.class, "context_window");
});

test("openai.mapError: 400 without code but with context message -> context_window", () => {
	// The /responses transport does not always fill `code`; it must fall back to the message.
	const ge = openaiAdapter.chat!.mapError(
		{
			status: 400,
			body: {
				error: {
					message:
						"This model's maximum context length is 400000 tokens. However, you requested 500000.",
				},
			},
		},
		ctx,
	);
	assert.equal(ge.class, "context_window");
});

test("openai embeddings handler: POST /embeddings with OpenAI body", () => {
	assert.equal(openaiAdapter.supportedCallTypes.has("embeddings"), true);
	const r = openaiAdapter.embeddings!.buildRequest(
		embeddingsReq,
		embeddingsCtx,
	);
	assert.equal(r.method, "POST");
	assert.equal(r.url, "https://api.openai.com/v1/embeddings");
	assert.equal(r.headers.authorization, "Bearer sk-test");
	const body = JSON.parse(r.body!);
	assert.deepEqual(body, {
		model: "text-embedding-3-small",
		input: ["hello", "world"],
		encoding_format: "float",
		dimensions: 256,
		user: "user-1",
	});
	const parsed = openaiAdapter.embeddings!.parseResponse(
		{
			object: "list",
			model: "text-embedding-3-small",
			data: [{ object: "embedding", embedding: [1, 2], index: 0 }],
			usage: { prompt_tokens: 2, total_tokens: 2 },
		},
		embeddingsCtx,
	);
	assert.deepEqual(parsed.usage, { promptTokens: 2, totalTokens: 2 });
});

test("openai.buildRequest: upstream call is store:false and extra_body cannot override it", () => {
	const r = openaiAdapter.chat!.buildRequest(baseReq, ctx);
	assert.equal(JSON.parse(r.body!).store, false);
	assert.throws(
		() =>
			openaiAdapter.chat!.buildRequest(
				{ ...baseReq, extraBody: { store: true } },
				ctx,
			),
		/extra_body.store/,
	);
});

test("openai.buildRequest: reasoning-capable models request encrypted reasoning content", () => {
	const r = openaiAdapter.chat!.buildRequest(baseReq, reasoningCtx);
	assert.deepEqual(JSON.parse(r.body!).include, [
		"reasoning.encrypted_content",
	]);

	// Deduped against a client-forwarded include; non-reasoning models do not request it.
	const merged = openaiAdapter.chat!.buildRequest(
		{
			...baseReq,
			responsesTransport: {
				include: [
					"reasoning.encrypted_content",
					"message.output_text.logprobs",
				],
			},
		},
		reasoningCtx,
	);
	assert.deepEqual(JSON.parse(merged.body!).include, [
		"reasoning.encrypted_content",
		"message.output_text.logprobs",
	]);
	assert.equal(
		JSON.parse(openaiAdapter.chat!.buildRequest(baseReq, ctx).body!).include,
		undefined,
	);
});

test("openai.buildRequest: replays encrypted reasoning items before function calls", () => {
	const r = openaiAdapter.chat!.buildRequest(
		{
			...baseReq,
			messages: [
				{
					role: "assistant",
					content: null,
					providerFields: {
						openai: {
							reasoning: [{ id: "rs_1", encrypted_content: "enc-1" }],
						},
					},
					toolCalls: [{ id: "call_1", name: "f", arguments: "{}" }],
				},
				{ role: "tool", toolCallId: "call_1", content: "ok" },
			],
		},
		reasoningCtx,
	);
	const input = JSON.parse(r.body!).input;
	assert.deepEqual(input[0], {
		type: "reasoning",
		id: "rs_1",
		encrypted_content: "enc-1",
		summary: [],
	});
	assert.equal(input[1].type, "function_call");
	assert.equal(input[2].type, "function_call_output");
});

test("openai.parseResponse: reasoning encrypted_content -> message providerFields", () => {
	const canonical = openaiAdapter.chat!.parseResponse(
		{
			id: "resp_1",
			created_at: 1,
			model: "gpt-5.5",
			status: "completed",
			output: [
				{
					type: "reasoning",
					id: "rs_1",
					summary: [{ type: "summary_text", text: "thinking" }],
					encrypted_content: "enc-1",
				},
				{
					type: "function_call",
					call_id: "call_1",
					name: "f",
					arguments: "{}",
				},
			],
			usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
		},
		reasoningCtx,
	);
	const message = canonical.choices[0]!.message;
	assert.equal(message.reasoning, "thinking");
	const fields = message.providerFields?.openai as Record<string, unknown>;
	assert.deepEqual(fields.reasoning, [
		{
			encrypted_content: "enc-1",
			id: "rs_1",
			summary: [{ type: "summary_text", text: "thinking" }],
		},
	]);
	assert.equal((fields.response_output as unknown[]).length, 2);
});

test("openai.parseStream: terminal failures throw instead of completing", async () => {
	async function* events() {
		yield {
			event: "response.failed",
			data: JSON.stringify({
				type: "response.failed",
				response: {
					status: "failed",
					error: { code: "server_error", message: "boom" },
				},
			}),
		};
	}
	const { responsesEventsToCanonicalChunks } = await import(
		"#contracts/openai/responsesTransport.ts"
	);
	await assert.rejects(async () => {
		for await (const _chunk of responsesEventsToCanonicalChunks(events())) {
			// consume
		}
	}, /terminal stream error/);
});

test("openai.parseStream: preserves WebSocket continuation error details", async () => {
	async function* events() {
		yield {
			event: "error",
			data: JSON.stringify({
				type: "error",
				status: 400,
				error: {
					code: "previous_response_not_found",
					message: "missing",
					param: "previous_response_id",
				},
			}),
		};
	}
	const { responsesEventsToCanonicalChunks } = await import(
		"#contracts/openai/responsesTransport.ts"
	);
	await assert.rejects(
		async () => {
			for await (const _chunk of responsesEventsToCanonicalChunks(events())) {
				// consume
			}
		},
		(error) =>
			GatewayError.is(error) &&
			error.httpStatus === 400 &&
			error.code === "previous_response_not_found" &&
			error.param === "previous_response_id" &&
			error.deploymentHealth === "neutral" &&
			error.provider?.status === 400,
	);
});

test("openai chat stream: in-band error objects throw", async () => {
	const stream = new Response(
		`data: {"error":{"message":"boom","type":"server_error"}}\n\n`,
	).body!;
	await assert.rejects(async () => {
		for await (const _chunk of openaiAdapter.chat!.parseStream(stream, {
			...ctx,
			transport: "chat_completions",
		})) {
			// consume
		}
	}, /boom/);
});

test("openai.parseStream: reasoning output_item.done -> delta.providerFields (deduped)", async () => {
	async function* events() {
		yield {
			event: "response.created",
			data: JSON.stringify({ response: { id: "resp_1", model: "gpt-5.5" } }),
		};
		yield {
			event: "response.output_item.done",
			data: JSON.stringify({
				item: { type: "reasoning", id: "rs_1", encrypted_content: "enc-1" },
			}),
		};
		yield {
			event: "response.completed",
			data: JSON.stringify({
				response: {
					id: "resp_1",
					status: "completed",
					output: [
						{ type: "reasoning", id: "rs_1", encrypted_content: "enc-1" },
						{ type: "reasoning", id: "rs_2", encrypted_content: "enc-2" },
					],
					usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
				},
			}),
		};
	}
	const collected: unknown[] = [];
	let terminalOutput: Record<string, unknown>[] | undefined;
	for await (const chunk of (
		await import("#contracts/openai/responsesTransport.ts")
	).responsesEventsToCanonicalChunks(events())) {
		for (const choice of chunk.choices) {
			if (choice.delta.providerFields !== undefined) {
				const state = openaiReasoningFromProviderFields(
					choice.delta.providerFields,
				);
				if (state !== undefined) collected.push(...state);
				terminalOutput =
					openaiResponsesStreamOutputFromProviderFields(
						choice.delta.providerFields,
					) ?? terminalOutput;
			}
		}
	}
	assert.deepEqual(collected, [
		{ encrypted_content: "enc-1", id: "rs_1" },
		{ encrypted_content: "enc-2", id: "rs_2" },
	]);
	assert.deepEqual(
		terminalOutput?.map((item) => item.id),
		["rs_1", "rs_2"],
	);
});
