import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import type { PlaygroundMessage } from "./transport";
import type { PlaygroundSettings } from "./api";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { Chat } from "@ai-sdk/react";
import { test } from "node:test";

import {
	createPlaygroundTransport,
	textStreamingMetrics,
	usageMetrics,
} from "./transport";

const settings: PlaygroundSettings = {
	systemPrompt: "You are helpful",
	parameters: { temperature: 0.2, max_tokens: 32 },
	reasoningEffort: "medium",
	stopSequences: [],
};

function sse(events: unknown[]): Response {
	return new Response(
		events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
		{
			headers: { "content-type": "text/event-stream" },
		},
	);
}

function userMessage(text = "hello"): PlaygroundMessage {
	return { id: "user-1", role: "user", parts: [{ type: "text", text }] };
}

test("Chat keeps summary parts separate across streaming, new turns and regeneration", async () => {
	let turn = 0;
	const requests: Record<string, unknown>[] = [];
	const transport = createPlaygroundTransport(
		"chat.completions",
		"model",
		settings,
		{
			baseURL: "https://gateway.test/v1",
			fetch: async (_input, init) => {
				requests.push(JSON.parse(String(init?.body)));
				turn++;
				const events: unknown[] = [];
				for (const [id, index, text] of [
					["rs_1", 0, "First"],
					["rs_1", 1, "Second"],
					["rs_2", 0, "Third"],
				] as const) {
					for (const status of ["streaming", "done"] as const) {
						events.push({
							choices: [
								{
									index: 0,
									delta: {
										...(status === "streaming"
											? { reasoning: `${text} ${turn}` }
											: {}),
										provider_specific_fields: {
											openai: {
												responses: { reasoning_part: { id, index, status } },
											},
										},
									},
								},
							],
						});
					}
				}
				events.push(
					{
						choices: [
							{
								index: 0,
								delta: {
									provider_specific_fields: {
										openai: {
											reasoning: [
												{
													id: `rs_turn_${turn}`,
													encrypted_content: `opaque-${turn}`,
													summary: [],
												},
											],
										},
									},
								},
							},
						],
					},
					{ choices: [{ index: 0, delta: { content: `Answer ${turn}` } }] },
					{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
				);
				return sse(events);
			},
		},
	);
	const chat = new Chat<PlaygroundMessage>({ transport });
	await chat.sendMessage({ text: "first request" });
	await chat.sendMessage({ text: "second request" });
	await chat.regenerate();
	assert.equal(chat.status, "ready");
	const assistants = chat.messages.filter(
		(message) => message.role === "assistant",
	);
	assert.equal(assistants.length, 2);
	for (const request of requests.slice(1)) {
		const assistant = (request.messages as Record<string, unknown>[]).find(
			(message) => message.role === "assistant",
		);
		assert.deepEqual(assistant?.provider_specific_fields, {
			openai: {
				reasoning: [
					{ id: "rs_turn_1", encrypted_content: "opaque-1", summary: [] },
				],
			},
		});
	}
	for (const [index, turnNumber] of [1, 3].entries()) {
		assert.deepEqual(
			assistants[index]?.parts
				.filter((part) => part.type === "reasoning")
				.map((part) => ({ text: part.text, state: part.state })),
			["First", "Second", "Third"].map((text) => ({
				text: `${text} ${turnNumber}`,
				state: "done",
			})),
		);
	}
});

async function streamParts(
	stream: ReadableStream<UIMessageChunk>,
): Promise<PlaygroundMessage[]> {
	const messages: PlaygroundMessage[] = [];
	for await (const message of readUIMessageStream<PlaygroundMessage>({
		stream,
	})) {
		messages.push(message);
	}
	return messages;
}

test("streams Responses reasoning, text, usage metrics and no reconnect", async () => {
	let nowValue = 100;
	const transport = createPlaygroundTransport("responses", "model", settings, {
		now: () => {
			nowValue += 10;
			return nowValue;
		},
		baseURL: "https://gateway.test/v1",
		fetch: async () =>
			sse([
				{
					type: "response.created",
					response: { id: "response-1", created_at: 1, model: "model" },
				},
				{
					type: "response.output_item.added",
					output_index: 0,
					item: { type: "reasoning", id: "reason-1" },
				},
				{
					type: "response.reasoning_summary_text.delta",
					item_id: "reason-1",
					output_index: 0,
					summary_index: 0,
					delta: "thinking",
				},
				{
					type: "response.reasoning_summary_part.done",
					item_id: "reason-1",
					output_index: 0,
					summary_index: 0,
				},
				{
					type: "response.output_item.done",
					output_index: 0,
					item: { type: "reasoning", id: "reason-1" },
				},
				{
					type: "response.output_item.added",
					output_index: 1,
					item: { type: "message", id: "message-1" },
				},
				{
					type: "response.output_text.delta",
					item_id: "message-1",
					output_index: 1,
					delta: "answer",
				},
				{
					type: "response.output_item.done",
					output_index: 1,
					item: { type: "message", id: "message-1" },
				},
				{
					type: "response.completed",
					response: {
						usage: {
							input_tokens: 4,
							input_tokens_details: { cached_tokens: 1 },
							output_tokens: 3,
							output_tokens_details: { reasoning_tokens: 1 },
							total_tokens: 7,
						},
					},
				},
			]),
	});
	const stream = await transport.sendMessages({
		trigger: "submit-message",
		chatId: "chat-1",
		messageId: undefined,
		messages: [userMessage()],
		abortSignal: undefined,
	});
	const messages = await streamParts(stream);
	const assistant = messages.at(-1);
	assert.ok(assistant);
	assert.deepEqual(
		assistant.parts.map((part) => part.type),
		["step-start", "reasoning", "text"],
	);
	assert.equal(
		assistant.parts.find((part) => part.type === "reasoning")?.text,
		"thinking",
	);
	assert.equal(
		assistant.parts.find((part) => part.type === "text")?.text,
		"answer",
	);
	const { metadata } = assistant;
	assert.equal(metadata?.inputTokens, 4);
	assert.equal(metadata?.outputTokens, 3);
	assert.equal(metadata?.reasoningTokens, 1);
	assert.equal(metadata?.cachedInputTokens, 1);
	assert.equal(metadata?.totalTokens, 7);
	assert.equal(metadata?.state, "completed");
	assert.equal(await transport.reconnectToStream({ chatId: "chat-1" }), null);
});

test("Chat Completions renders gateway reasoning and preserves hidden reasoning counts", async () => {
	for (const reasoning of [undefined, "Thinking through the answer"]) {
		const transport = createPlaygroundTransport(
			"chat.completions",
			"model",
			settings,
			{
				baseURL: "https://gateway.test/v1",
				fetch: async () =>
					sse([
						{
							id: "chat-1",
							created: 1,
							model: "model",
							choices: [
								{
									index: 0,
									delta: {
										role: "assistant",
										...(reasoning === undefined ? {} : { reasoning }),
									},
									finish_reason: null,
								},
							],
						},
						{
							id: "chat-1",
							created: 1,
							model: "model",
							choices: [
								{ index: 0, delta: { content: "Answer" }, finish_reason: null },
							],
						},
						{
							id: "chat-1",
							created: 1,
							model: "model",
							choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
							usage: {
								prompt_tokens: 3,
								completion_tokens: 8,
								total_tokens: 11,
								completion_tokens_details: { reasoning_tokens: 4 },
							},
						},
					]),
			},
		);
		const messages = await streamParts(
			await transport.sendMessages({
				trigger: "submit-message",
				chatId: "chat-1",
				messageId: undefined,
				messages: [userMessage()],
				abortSignal: undefined,
			}),
		);
		const assistant = messages.at(-1);
		assert.equal(
			assistant?.parts.find((part) => part.type === "reasoning")?.text,
			reasoning,
		);
		assert.equal(
			assistant?.parts.find((part) => part.type === "text")?.text,
			"Answer",
		);
		assert.equal(assistant?.metadata?.reasoningTokens, 4);
	}
});

test("Messages reads optional thinking token breakdown without inventing zero", async () => {
	for (const count of [undefined, 0, 4]) {
		const transport = createPlaygroundTransport("messages", "model", settings, {
			baseURL: "https://gateway.test/v1",
			fetch: async () =>
				sse([
					{
						type: "message_start",
						message: {
							id: "msg_test",
							model: "model",
							role: "assistant",
							content: [],
							usage: { input_tokens: 3, output_tokens: 0 },
						},
					},
					{
						type: "content_block_start",
						index: 0,
						content_block: { type: "text", text: "" },
					},
					{
						type: "content_block_delta",
						index: 0,
						delta: { type: "text_delta", text: "Answer" },
					},
					{ type: "content_block_stop", index: 0 },
					{
						type: "message_delta",
						delta: { stop_reason: "end_turn" },
						usage: {
							output_tokens: 8,
							...(count === undefined
								? {}
								: { output_tokens_details: { thinking_tokens: count } }),
						},
					},
					{ type: "message_stop" },
				]),
		});
		const messages = await streamParts(
			await transport.sendMessages({
				trigger: "submit-message",
				chatId: "chat-1",
				messageId: undefined,
				messages: [userMessage()],
				abortSignal: undefined,
			}),
		);
		assert.equal(messages.at(-1)?.metadata?.reasoningTokens, count);
	}
});

test("chat completions streaming errors become UI errors without retries", async () => {
	let calls = 0;
	const transport = createPlaygroundTransport(
		"chat.completions",
		"model",
		settings,
		{
			baseURL: "https://gateway.test/v1",
			fetch: async () => {
				calls++;
				return sse([
					{
						error: {
							message: "upstream rejected",
							type: "invalid_request_error",
						},
					},
				]);
			},
		},
	);
	const stream = await transport.sendMessages({
		trigger: "submit-message",
		chatId: "chat-1",
		messageId: undefined,
		messages: [userMessage()],
		abortSignal: undefined,
	});
	const chunks: unknown[] = [];
	const reader = stream.getReader();
	while (true) {
		const next = await reader.read();
		if (next.done) {
			break;
		}
		chunks.push(next.value);
	}
	assert.match(
		JSON.stringify(chunks),
		/upstream rejected|inference request failed/i,
	);
	assert.equal(calls, 1);
});

test("abort signals stop an in-flight transport request", async () => {
	const controller = new AbortController();
	let sawAbort = false;
	const transport = createPlaygroundTransport(
		"chat.completions",
		"model",
		settings,
		{
			baseURL: "https://gateway.test/v1",
			fetch: async (_input, init) => {
				init?.signal?.addEventListener("abort", () => {
					sawAbort = true;
				});
				return new Promise<Response>((resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new DOMException("Aborted", "AbortError")),
					);
					setTimeout(() => resolve(sse([])), 1000);
				});
			},
		},
	);
	const pending = transport.sendMessages({
		trigger: "submit-message",
		chatId: "chat-1",
		messageId: undefined,
		messages: [userMessage()],
		abortSignal: controller.signal,
	});
	const stream = await pending;
	const reading = streamParts(stream);
	await new Promise((resolve) => setTimeout(resolve, 0));
	controller.abort();
	await reading;
	assert.equal(sawAbort, true);
});

test("usage metrics expose throughput and optional provider details", () => {
	assert.deepEqual(
		usageMetrics(
			{
				inputTokens: 4,
				outputTokens: 8,
				totalTokens: 12,
				inputTokenDetails: {
					noCacheTokens: 2,
					cacheReadTokens: 2,
					cacheWriteTokens: undefined,
				},
				outputTokenDetails: { reasoningTokens: 3, textTokens: 5 },
			},
			2000,
		),
		{
			inputTokens: 4,
			outputTokens: 8,
			totalTokens: 12,
			reasoningTokens: 3,
			cachedInputTokens: 2,
			requestTokensPerSecond: 4,
		},
	);
});

test("invalid token counts remain unavailable instead of displaying fractional tokens", () => {
	const metrics = usageMetrics(
		{
			inputTokens: 1.5,
			outputTokens: -2,
			totalTokens: -0.5,
			inputTokenDetails: {
				noCacheTokens: undefined,
				cacheReadTokens: Number.NaN,
				cacheWriteTokens: undefined,
			},
			outputTokenDetails: {
				reasoningTokens: Number.POSITIVE_INFINITY,
				textTokens: undefined,
			},
		},
		2000,
	);
	assert.equal(metrics.inputTokens, undefined);
	assert.equal(metrics.outputTokens, undefined);
	assert.equal(metrics.totalTokens, undefined);
	assert.equal(metrics.cachedInputTokens, undefined);
	assert.equal(metrics.reasoningTokens, undefined);
	assert.equal(metrics.requestTokensPerSecond, undefined);
});

test("Chat lifecycle sends, regenerates, stops, and propagates transport errors", async () => {
	const calls: string[] = [];
	const transport = {
		async sendMessages(options: {
			trigger: string;
			messages: UIMessage[];
			abortSignal: AbortSignal | undefined;
		}) {
			calls.push(options.trigger);
			if (options.trigger === "regenerate-message") {
				throw new Error("regenerate failed");
			}
			return new ReadableStream({
				start(controller) {
					controller.enqueue({ type: "start", messageId: "assistant-1" });
					controller.enqueue({ type: "text-start", id: "text-1" });
					controller.enqueue({
						type: "text-delta",
						id: "text-1",
						delta: "reply",
					});
					controller.enqueue({ type: "text-end", id: "text-1" });
					controller.enqueue({ type: "finish", finishReason: "stop" });
					controller.close();
				},
			});
		},
		async reconnectToStream() {
			return null;
		},
	};
	const chat = new Chat({ id: "chat-1", transport });
	await chat.sendMessage({ text: "hello" });
	const text = chat.messages.at(-1)?.parts[0];
	assert.ok(text?.type === "text");
	assert.equal(text.text, "reply");
	await chat.regenerate();
	assert.deepEqual(calls, ["submit-message", "regenerate-message"]);
	chat.clearError();
	assert.equal(chat.status, "ready");
	await chat.stop();
	assert.equal(chat.status, "ready");
});

test("browser-runtime cancellation handles SDK telemetry promises", () => {
	const script = `
		import { createPlaygroundTransport } from ${JSON.stringify(new URL("./transport.ts", import.meta.url).href)};
		import { Chat } from '@ai-sdk/react';
		Object.defineProperty(process, 'release', { value: { name: 'browser' } });
		let started;
		const ready = new Promise(resolve => { started = resolve; });
		const transport = createPlaygroundTransport('chat.completions', 'model', { systemPrompt: '', parameters: {}, stopSequences: [] }, {
			baseURL: 'https://gateway.test/v1',
			fetch: (_input, init) => new Promise((_resolve, reject) => {
				init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
				started();
			}),
		});
		const chat = new Chat({ transport });
		const pending = chat.sendMessage({ text: 'cancel' });
		await ready;
		await chat.stop();
		await pending;
		await new Promise(resolve => setTimeout(resolve, 10));
		if (chat.status !== 'ready') throw new Error('Chat did not stop');
	`;
	const result = spawnSync(process.execPath, ["--eval", script], {
		encoding: "utf8",
		cwd: new URL("../../..", import.meta.url),
		timeout: 10_000,
	});
	assert.equal(result.status, 0, result.stderr);
});

test("missing Chat usage fields are not reported as SDK-normalized zeros", () => {
	const metrics = usageMetrics(
		{
			inputTokens: 4,
			outputTokens: 0,
			totalTokens: 4,
			inputTokenDetails: {
				noCacheTokens: 4,
				cacheReadTokens: 0,
				cacheWriteTokens: undefined,
			},
			outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
			raw: { prompt_tokens: 4 },
		},
		1000,
		"chat.completions",
	);
	assert.equal(metrics.inputTokens, 4);
	assert.equal(metrics.outputTokens, undefined);
	assert.equal(metrics.totalTokens, undefined);
	assert.equal(metrics.cachedInputTokens, undefined);
	assert.equal(metrics.reasoningTokens, undefined);
	assert.equal(metrics.requestTokensPerSecond, undefined);
});

test("streaming speed excludes initial wait, final closure and reported reasoning", () => {
	// 104 output tokens over 30 s gives 3.47 tok/s globally, but the 100 text
	// tokens arrived over one second after waiting 20 s for the first text.
	const metrics = textStreamingMetrics(
		{ outputTokens: 104, reasoningTokens: 4 },
		20_000,
		21_000,
		10,
		true,
	);
	assert.equal(metrics.outputTokensPerSecond, 99);
	assert.equal(metrics.textDurationMs, 1000);
	assert.equal(
		textStreamingMetrics(
			{ outputTokens: 104, reasoningTokens: 4 },
			0,
			1000,
			10,
			true,
		).outputTokensPerSecond,
		99,
	);
});

test("text speed preserves fractional rates and never counts chunks as tokens", () => {
	assert.equal(
		textStreamingMetrics({ outputTokens: 8 }, 100, 2100, 2, false)
			.outputTokensPerSecond,
		3.5,
	);
	assert.equal(
		textStreamingMetrics({ outputTokens: 8 }, 100, 2100, 7, false)
			.outputTokensPerSecond,
		3.5,
	);
});

test("unmeasurable, incomplete and inconsistent streams do not invent a speed", () => {
	for (const metrics of [
		textStreamingMetrics({}, 0, 1000, 2, false),
		textStreamingMetrics({ outputTokens: 20 }, undefined, undefined, 0, false),
		textStreamingMetrics({ outputTokens: 20 }, 10, 10, 1, false),
		textStreamingMetrics({ outputTokens: 20 }, 10, 10, 2, false),
		textStreamingMetrics({ outputTokens: 20 }, 10, 0, 2, false),
		textStreamingMetrics({ outputTokens: 20 }, 0, 1000, 2, true),
		textStreamingMetrics(
			{ outputTokens: 20, reasoningTokens: 25 },
			0,
			1000,
			2,
			true,
		),
		textStreamingMetrics({ outputTokens: 1 }, 0, 1000, 2, false),
	]) {
		assert.equal(metrics.outputTokensPerSecond, undefined);
	}
});

test("Chat SSE usage and timestamps feed separate request and streaming rates", async () => {
	let clock = 0;
	const transport = createPlaygroundTransport(
		"chat.completions",
		"model",
		settings,
		{
			now: () => {
				clock += 100;
				return clock;
			},
			baseURL: "https://gateway.test/v1",
			fetch: async () =>
				sse([
					{
						choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
					},
					{ choices: [{ index: 0, delta: { content: "First " } }] },
					{ choices: [{ index: 0, delta: { content: "second" } }] },
					{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
					{ choices: [], usage: { prompt_tokens: 4, completion_tokens: 11 } },
				]),
		},
	);
	const stream = await transport.sendMessages({
		trigger: "submit-message",
		chatId: "chat",
		messageId: undefined,
		messages: [userMessage()],
		abortSignal: undefined,
	});
	const messages = await streamParts(stream);
	const metrics = messages.at(-1)?.metadata;
	assert.ok(metrics?.durationMs);
	assert.equal(metrics.textDurationMs, 100);
	assert.equal(metrics.outputTokensPerSecond, 100);
	assert.equal(
		metrics.requestTokensPerSecond,
		11 / (metrics.durationMs / 1000),
	);
	assert.ok(
		metrics.durationMs > (metrics.firstTextMs ?? 0) + metrics.textDurationMs,
	);
	assert.equal(metrics.inputTokens, 4);
	assert.equal(metrics.outputTokens, 11);
});
