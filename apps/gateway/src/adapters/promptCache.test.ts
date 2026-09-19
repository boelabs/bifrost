import "./index.ts";

import { buildResponsesWebSocketMessage } from "./openaiResponsesWebSocket.ts";
import { parseResponsesUsage } from "#contracts/openai/responsesTransport.ts";
import { messagesRequestSchema } from "#contracts/anthropic/messages.ts";
import { responsesRequestSchema } from "#contracts/openai/responses.ts";
import type { AdapterContext } from "./types.ts";
import type { Usage } from "#core/usage.ts";
import { getAdapter } from "./registry.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	canonicalChunksToResponsesEvents,
	canonicalToResponsesResponse,
	responsesRequestToCanonical,
} from "#contracts/openai/responsesRender.ts";

import {
	canonicalChunksToMessagesEvents,
	canonicalToMessagesResponse,
	messagesRequestToCanonical,
} from "#contracts/anthropic/messagesRender.ts";

import {
	toCanonicalChatRequest,
	toOpenAIChatResponse,
	chatRequestSchema,
} from "#contracts/openai/chat.ts";

import {
	parseOpenAIChatResponse,
	parseOpenAIChatChunk,
} from "#contracts/openai/chatTransport.ts";

import type {
	CanonicalChatStreamChunk,
	CanonicalChatRequest,
} from "#core/canonical.ts";

const context = (transport: AdapterContext["transport"]): AdapterContext => ({
	transport,
	upstreamModel: "private-deployment",
	requestId: "cache-test",
	credentials: {
		apiKey: "test-key",
		baseUrl: "https://fixture.openai.azure.com",
	},
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: false,
			structuredOutputs: true,
		},
	},
});
const responseRequest = () =>
	responsesRequestSchema.parse({ model: "public-model", input: "hello" });
const readWriteUsage: Usage = {
	promptTokens: 2000,
	completionTokens: 10,
	totalTokens: 2010,
	cacheReadTokens: 1500,
	cacheWriteTokens: 300,
};
const chatUsage = {
	prompt_tokens: 2000,
	completion_tokens: 10,
	total_tokens: 2010,
	prompt_tokens_details: { cached_tokens: 1500, cache_write_tokens: 300 },
};
const responsesUsage = {
	input_tokens: 2000,
	output_tokens: 10,
	total_tokens: 2010,
	input_tokens_details: { cached_tokens: 1500, cache_write_tokens: 300 },
};
const sse = (events: unknown[]) =>
	new Response(
		events
			.map(
				(event) =>
					`data: ${event === "[DONE]" ? event : JSON.stringify(event)}\n\n`,
			)
			.join(""),
	).body!;
const chatRequest = (extra: Record<string, unknown> = {}) =>
	toCanonicalChatRequest(
		chatRequestSchema.parse({
			model: "public-model",
			messages: [{ role: "user", content: "hello" }],
			...extra,
		}),
	);
const build = (
	key: string,
	req: CanonicalChatRequest,
	transport: AdapterContext["transport"],
) =>
	JSON.parse(
		getAdapter(key)!.chat!.buildRequest(req, context(transport)).body!,
	);

for (const key of [
	"openai",
	"openaicompatible",
	"azureopenai",
	"azurefoundry",
	"deepseek",
	"moonshot",
	"zai",
	"minimax",
	"vercel",
]) {
	const adapter = getAdapter(key)!;
	for (const transport of adapter.transports!.chat!.supported) {
		for (const stream of [false, true]) {
			test(`${key}/${transport}: cache reads and writes survive ${stream ? "SSE" : "JSON"} and all public formats`, async () => {
				const raw =
					transport === "responses"
						? {
								id: "resp_test",
								model: "private-deployment",
								created_at: 1,
								status: "completed",
								output: [],
								usage: responsesUsage,
							}
						: {
								id: "chat_test",
								model: "private-deployment",
								created: 1,
								choices: [
									{
										index: 0,
										message: { role: "assistant", content: "ok" },
										finish_reason: "stop",
									},
								],
								usage: chatUsage,
							};
				if (stream) {
					const events =
						transport === "responses"
							? [{ type: "response.completed", response: raw }]
							: [
									{
										...raw,
										choices: [
											{
												index: 0,
												delta: { content: "ok" },
												finish_reason: "stop",
											},
										],
									},
									"[DONE]",
								];
					const chunks: CanonicalChatStreamChunk[] = [];
					for await (const chunk of adapter.chat!.parseStream(
						sse(events),
						context(transport),
					)) {
						chunks.push(chunk);
					}
					assert.deepEqual(
						chunks.find((chunk) => chunk.usage)?.usage,
						readWriteUsage,
					);
					async function* replay() {
						yield* chunks;
					}
					const rendered: any[] = [];
					for await (const event of canonicalChunksToResponsesEvents(replay(), {
						req: responseRequest(),
						publicModel: "public-model",
					})) {
						rendered.push(JSON.parse(event.data));
					}
					assert.equal(
						rendered.find((event) => event.type === "response.completed")
							.response.usage.input_tokens_details.cache_write_tokens,
						300,
					);
					let roundTrip: Usage | undefined;
					const messages: any[] = [];
					for await (const event of canonicalChunksToMessagesEvents(replay(), {
						publicModel: "public-model",
					})) {
						messages.push(JSON.parse(event.data));
					}
					for await (const chunk of getAdapter("anthropic")!.chat!.parseStream(
						sse(messages),
						context("messages"),
					)) {
						if (chunk.usage) {
							roundTrip = chunk.usage;
						}
					}
					assert.deepEqual(roundTrip, readWriteUsage);
				} else {
					const parsed = adapter.chat!.parseResponse(raw, context(transport));
					assert.deepEqual(parsed.usage, readWriteUsage);
					assert.equal(
						toOpenAIChatResponse(parsed, "public-model").usage
							.prompt_tokens_details?.cache_write_tokens,
						300,
					);
					const response = canonicalToResponsesResponse(parsed, {
						req: responseRequest(),
						publicModel: "public-model",
					});
					assert.deepEqual(response.usage, {
						...responsesUsage,
						output_tokens_details: { reasoning_tokens: 0 },
					});
					const messages = canonicalToMessagesResponse(parsed, {
						publicModel: "public-model",
					});
					assert.equal(
						(messages.usage as Record<string, unknown>)
							.cache_creation_input_tokens,
						300,
					);
					assert.equal(
						(messages.usage as Record<string, unknown>).input_tokens,
						200,
					);
				}
			});
		}
	}
}

for (const source of ["chat", "responses"]) {
	for (const transport of ["chat_completions", "responses"] as const) {
		for (const stream of [false, true]) {
			test(`Azure ${source} to ${transport}, stream=${stream}: preserve policy and instruction boundaries`, () => {
				const marker = { mode: "explicit" };
				const options = { mode: "explicit", ttl: "30m" };
				const common = {
					model: "public-model",
					stream,
					prompt_cache_key: "tenant:stable-prefix",
					prompt_cache_options: options,
				};
				const canonical =
					source === "chat"
						? toCanonicalChatRequest(
								chatRequestSchema.parse({
									...common,
									messages: [
										{
											role: "system",
											content: [
												{
													type: "text",
													text: "stable",
													prompt_cache_breakpoint: marker,
												},
											],
										},
										{ role: "user", content: "variable" },
									],
								}),
							)
						: responsesRequestToCanonical(
								responsesRequestSchema.parse({
									...common,
									input: [
										{
											role: "system",
											content: [
												{
													type: "input_text",
													text: "stable",
													prompt_cache_breakpoint: marker,
												},
											],
										},
										{ role: "user", content: "variable" },
									],
								}),
							);
				const body = build("azureopenai", canonical, transport);
				assert.equal(body.model, "private-deployment");
				assert.equal(body.prompt_cache_key, "tenant:stable-prefix");
				assert.deepEqual(body.prompt_cache_options, options);
				const messages = transport === "responses" ? body.input : body.messages;
				assert.equal(messages[0].role, "system");
				assert.deepEqual(
					messages[0].content[0].prompt_cache_breakpoint,
					marker,
				);
				assert.equal(body.instructions, undefined);
				assert.equal(messages[1].role, "user");
				if (stream && transport === "chat_completions") {
					assert.equal(body.stream_options.include_usage, true);
				}
				const ws = buildResponsesWebSocketMessage(
					canonical,
					context("responses"),
					{ generate: true },
				);
				assert.deepEqual(ws.prompt_cache_options, options);
				assert.match(JSON.stringify(ws.input), /prompt_cache_breakpoint/);
			});
		}
	}
}

test("cache controls accept the previous extra_body escape hatch and reject collisions", () => {
	const canonical = chatRequest({
		extra_body: {
			prompt_cache_options: { mode: "explicit" },
			prompt_cache_retention: "24h",
		},
	});
	for (const transport of ["responses", "chat_completions"] as const) {
		const body = build("azureopenai", canonical, transport);
		assert.deepEqual(body.prompt_cache_options, { mode: "explicit" });
		assert.equal(body.prompt_cache_retention, "24h");
	}
	assert.throws(() =>
		chatRequest({
			prompt_cache_options: { mode: "implicit" },
			extra_body: { prompt_cache_options: { mode: "explicit" } },
		}),
	);
	assert.throws(() => chatRequest({ prompt_cache_options: { ttl: "1h" } }));
	for (const [provider, transport] of [
		["anthropic", "messages"],
		["googleaistudio", "generate_content"],
	] as const) {
		assert.throws(
			() => build(provider, canonical, transport),
			/cannot preserve/,
		);
	}
});

test("provider cache aliases preserve zero, absence, and nested-field precedence", () => {
	for (const field of ["cached_tokens", "prompt_cache_hit_tokens"]) {
		for (const value of [0, 1500]) {
			const raw = {
				choices: [],
				usage: { prompt_tokens: 2000, completion_tokens: 10, [field]: value },
			};
			assert.equal(parseOpenAIChatResponse(raw).usage.cacheReadTokens, value);
			assert.equal(parseOpenAIChatChunk(raw)?.usage?.cacheReadTokens, value);
			assert.equal(
				parseOpenAIChatResponse({
					...raw,
					usage: { ...raw.usage, prompt_tokens_details: { cached_tokens: 0 } },
				}).usage.cacheReadTokens,
				0,
			);
		}
	}
	assert.equal(
		parseOpenAIChatResponse({ choices: [], usage: {} }).usage.cacheReadTokens,
		undefined,
	);
	assert.equal(
		parseResponsesUsage({ input_tokens_details: { cache_write_tokens: 0 } })
			.cacheWriteTokens,
		0,
	);
	assert.equal(parseResponsesUsage({}).cacheWriteTokens, undefined);
	assert.equal(
		parseResponsesUsage({ input_tokens: 20, output_tokens: 3 }).totalTokens,
		23,
	);
});

test("Anthropic retains automatic cache control and tool block breakpoints", () => {
	const marker = { type: "ephemeral", ttl: "1h" };
	const canonical = messagesRequestToCanonical(
		messagesRequestSchema.parse({
			model: "public-model",
			max_tokens: 20,
			cache_control: marker,
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_1",
							name: "lookup",
							input: {},
							cache_control: marker,
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "call_1",
							content: "result",
							cache_control: marker,
						},
					],
				},
			],
		}),
	);
	const body = build("anthropic", canonical, "messages");
	assert.equal(canonical.requiresNativeWire, true);
	assert.deepEqual(body.cache_control, marker);
	assert.deepEqual(body.messages[0].content[0].cache_control, marker);
	assert.deepEqual(body.messages[1].content[0].cache_control, marker);
});

test("Anthropic terminal usage replaces cumulative values without losing omitted cache fields", async () => {
	for (const terminal of [
		{
			input_tokens: 200,
			cache_read_input_tokens: 1500,
			cache_creation_input_tokens: 300,
		},
		{
			input_tokens: 200,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
		},
		{},
	]) {
		const initial = {
			input_tokens: 100,
			cache_read_input_tokens: 500,
			cache_creation_input_tokens: 100,
			cache_creation: {
				ephemeral_5m_input_tokens: 60,
				ephemeral_1h_input_tokens: 40,
			},
		};
		const events = [
			{
				type: "message_start",
				message: { id: "msg_test", model: "test", usage: initial },
			},
			{
				type: "message_delta",
				delta: { stop_reason: "end_turn" },
				usage: { ...terminal, output_tokens: 10 },
			},
			{ type: "message_stop" },
		];
		let result: Usage | undefined;
		for await (const chunk of getAdapter("anthropic")!.chat!.parseStream(
			sse(events),
			context("messages"),
		)) {
			if (chunk.usage) {
				result = chunk.usage;
			}
		}
		const read =
			terminal.cache_read_input_tokens ?? initial.cache_read_input_tokens;
		const write =
			terminal.cache_creation_input_tokens ??
			initial.cache_creation_input_tokens;
		assert.equal(
			result?.promptTokens,
			(terminal.input_tokens ?? initial.input_tokens) + read + write,
		);
		assert.equal(result?.cacheReadTokens, read);
		assert.equal(result?.cacheWriteTokens, write);
		assert.deepEqual(
			result?.cacheWriteTokensByTtl,
			terminal.cache_creation_input_tokens === undefined
				? { "300": 60, "3600": 40 }
				: undefined,
		);
	}
});

test("Google retains explicit resource references and cached token usage in JSON and SSE", async () => {
	const request = chatRequest({
		extra_body: { cachedContent: "cachedContents/fixture" },
	});
	assert.equal(
		build("googleaistudio", request, "generate_content").cachedContent,
		"cachedContents/fixture",
	);
	const raw = {
		candidates: [
			{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" },
		],
		usageMetadata: {
			promptTokenCount: 2000,
			candidatesTokenCount: 10,
			totalTokenCount: 2010,
			cachedContentTokenCount: 1500,
		},
	};
	const handler = getAdapter("googleaistudio")!.chat!;
	assert.equal(
		handler.parseResponse(raw, context("generate_content")).usage
			.cacheReadTokens,
		1500,
	);
	let usage: Usage | undefined;
	for await (const chunk of handler.parseStream(
		sse([raw]),
		context("generate_content"),
	)) {
		if (chunk.usage) {
			usage = chunk.usage;
		}
	}
	assert.equal(usage?.cacheReadTokens, 1500);
});

test("Vercel receives automatic caching options from both public OpenAI contracts", () => {
	const options = { gateway: { caching: "auto" } };
	const requests = [
		chatRequest({ providerOptions: options }),
		responsesRequestToCanonical(
			responsesRequestSchema.parse({
				model: "public-model",
				input: "hi",
				providerOptions: options,
			}),
		),
	];
	for (const req of requests) {
		for (const transport of ["responses", "chat_completions"] as const) {
			assert.deepEqual(
				build("vercel", req, transport).providerOptions,
				options,
			);
		}
	}
	assert.throws(() =>
		chatRequest({
			providerOptions: options,
			extra_body: { providerOptions: options },
		}),
	);
});

test("multimodal breakpoints and native Responses input preserve their prefix", () => {
	const marker = { mode: "explicit" };
	const canonical = chatRequest({
		messages: [
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: { url: "https://fixture.example/image.png" },
						prompt_cache_breakpoint: marker,
					},
					{
						type: "file",
						file: { file_id: "file-1" },
						prompt_cache_breakpoint: marker,
					},
				],
			},
		],
	});
	for (const transport of ["chat_completions", "responses"] as const) {
		const body = build("azureopenai", canonical, transport);
		const content =
			transport === "responses"
				? body.input[0].content
				: body.messages[0].content;
		assert.deepEqual(
			content.map((p: Record<string, unknown>) => p.prompt_cache_breakpoint),
			[marker, marker],
		);
	}
	const native = responsesRequestToCanonical(
		responsesRequestSchema.parse({
			model: "public-model",
			instructions: "Keep this instruction",
			input: [
				{
					type: "computer_call_output",
					call_id: "call_1",
					output: {
						type: "computer_screenshot",
						image_url: "https://fixture.example/image.png",
					},
				},
				{
					role: "user",
					content: [
						{
							type: "input_text",
							text: "stable",
							prompt_cache_breakpoint: marker,
						},
					],
				},
			],
		}),
	);
	const body = build("azureopenai", native, "responses");
	assert.equal(body.instructions, "Keep this instruction");
	assert.equal(body.input[0].type, "computer_call_output");
	assert.deepEqual(body.input[1].content[0].prompt_cache_breakpoint, marker);
});

test("Anthropic tool markers retain their original position among text blocks", () => {
	const marker = { type: "ephemeral" };
	const req = messagesRequestToCanonical(
		messagesRequestSchema.parse({
			model: "public-model",
			max_tokens: 20,
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "call_1",
							name: "lookup",
							input: {},
							cache_control: marker,
						},
						{ type: "text", text: "after the cached prefix" },
					],
				},
			],
		}),
	);
	const body = build("anthropic", req, "messages");
	assert.equal(body.messages[0].content[0].type, "tool_use");
	assert.equal(body.messages[0].content[1].text, "after the cached prefix");
});

test("Anthropic lifetime usage survives JSON and all public renderers", () => {
	const raw = {
		id: "msg_test",
		type: "message",
		role: "assistant",
		model: "test",
		content: [{ type: "text", text: "ok" }],
		stop_reason: "end_turn",
		usage: {
			input_tokens: 200,
			output_tokens: 10,
			cache_read_input_tokens: 1500,
			cache_creation_input_tokens: 300,
			cache_creation: {
				ephemeral_5m_input_tokens: 100,
				ephemeral_1h_input_tokens: 200,
			},
		},
	};
	const parsed = getAdapter("anthropic")!.chat!.parseResponse(
		raw,
		context("messages"),
	);
	assert.deepEqual(parsed.usage, {
		...readWriteUsage,
		cacheWriteTokensByTtl: { "300": 100, "3600": 200 },
	});
	const messages = canonicalToMessagesResponse(parsed, {
		publicModel: "public-model",
	});
	assert.deepEqual(
		(messages.usage as Record<string, unknown>).cache_creation,
		raw.usage.cache_creation,
	);
	const chat = toOpenAIChatResponse(parsed, "public-model");
	assert.deepEqual(parseOpenAIChatResponse(chat).usage, parsed.usage);
	const response = canonicalToResponsesResponse(parsed, {
		req: responseRequest(),
		publicModel: "public-model",
	});
	assert.deepEqual(
		parseResponsesUsage(
			response.usage as Parameters<typeof parseResponsesUsage>[0],
		),
		{ ...parsed.usage, reasoningTokens: 0 },
	);
});
