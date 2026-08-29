import { messagesRequestSchema } from "./messages.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	canonicalChunksToMessagesEvents,
	canonicalToMessagesResponse,
	messagesRequestToCanonical,
} from "./messagesRender.ts";

import type {
	CanonicalChatStreamChunk,
	CanonicalChatResponse,
} from "#core/canonical.ts";

const parse = (b: unknown) => messagesRequestSchema.parse(b);
const opts = { publicModel: "public-claude" };

interface TestJsonObject extends Record<string, unknown> {
	content: [TestJsonObject, TestJsonObject, ...TestJsonObject[]];
	usage: TestJsonObject;
}

test("request->canonical: system, string content, max_tokens", () => {
	const u = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 100,
			system: "Be brief.",
			messages: [{ role: "user", content: "hello" }],
		}),
	);
	assert.equal(u.messages[0]!.role, "system");
	assert.equal(u.messages[0]!.content, "Be brief.");
	assert.equal(u.messages[1]!.content, "hello");
	assert.equal(u.maxTokens, 100);
});

test("request->canonical: metadata does not require the Messages wire", () => {
	const u = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 100,
			metadata: { user_id: "user-1" },
			messages: [{ role: "user", content: "hello" }],
		}),
	);

	assert.equal(u.requiresNativeWire, undefined);
	assert.deepEqual(u.messagesTransport, {
		metadata: { user_id: "user-1" },
	});
});

test("request->canonical: document URL, base64, and file references become files", () => {
	const canonical = messagesRequestToCanonical(
		parse({
			model: "message-model",
			max_tokens: 100,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "document",
							title: "remote.pdf",
							source: {
								type: "url",
								url: "https://assets.example/remote.pdf",
							},
						},
						{
							type: "document",
							source: {
								type: "base64",
								media_type: "application/pdf",
								data: "AAAA",
							},
						},
						{
							type: "document",
							source: { type: "file", file_id: "file-123" },
						},
					],
				},
			],
		}),
	);
	const content = canonical.messages[0]?.content;
	assert.ok(Array.isArray(content));
	assert.deepEqual(content, [
		{
			type: "file",
			fileUrl: "https://assets.example/remote.pdf",
			filename: "remote.pdf",
		},
		{ type: "file", fileData: "data:application/pdf;base64,AAAA" },
		{ type: "file", fileId: "file-123" },
	]);
});

test("request->canonical: malformed document sources are rejected", () => {
	assert.throws(
		() =>
			messagesRequestToCanonical(
				parse({
					model: "message-model",
					max_tokens: 100,
					messages: [
						{
							role: "user",
							content: [{ type: "document", source: { type: "url" } }],
						},
					],
				}),
			),
		(error: unknown) =>
			(error as { code?: string }).code === "invalid_file_source",
	);
});

test("request->canonical: cache_control is preserved in system (array), content, and tools", () => {
	const u = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 100,
			system: [
				{
					type: "text",
					text: "Preamble",
					cache_control: { type: "ephemeral" },
				},
			],
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "hello",
							cache_control: { type: "ephemeral" },
						},
					],
				},
			],
			tools: [
				{
					name: "f",
					input_schema: { type: "object" },
					cache_control: { type: "ephemeral" },
				},
			],
		}),
	);
	// system with cache_control -> preserved as parts (not flattened to string).
	assert.deepEqual(u.messages[0]!.content, [
		{ type: "text", text: "Preamble", cacheControl: { type: "ephemeral" } },
	]);
	const userContent = u.messages[1]!.content as Array<{
		cacheControl?: unknown;
	}>;
	assert.deepEqual(userContent[0]!.cacheControl, { type: "ephemeral" });
	assert.deepEqual(u.tools?.[0]?.cacheControl, { type: "ephemeral" });
	assert.equal(u.requiresNativeWire, true);
});

test("request->canonical: system without cache_control flattens to string", () => {
	const u = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 100,
			system: [
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
			],
			messages: [{ role: "user", content: "hello" }],
		}),
	);
	assert.equal(u.messages[0]!.content, "a\nb");
});

test("request->canonical: assistant tool_use and user tool_result", () => {
	const u = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 50,
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: "tu_1", name: "f", input: { x: 1 } },
					],
				},
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "tu_1", content: "42" },
					],
				},
			],
		}),
	);
	assert.equal(u.messages[0]!.toolCalls?.[0]?.name, "f");
	assert.equal(u.messages[0]!.toolCalls?.[0]?.arguments, '{"x":1}');
	assert.equal(u.messages[1]!.role, "tool");
	assert.equal(u.messages[1]!.toolCallId, "tu_1");
	assert.equal(u.messages[1]!.content, "42");
});

test("request->canonical: tool_result preserves errors and multimodal content", () => {
	const canonical = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 50,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_1",
							is_error: true,
							content: [
								{ type: "text", text: "capture failed" },
								{
									type: "image",
									source: {
										type: "base64",
										media_type: "image/png",
										data: "AAAA",
									},
								},
							],
						},
					],
				},
			],
		}),
	);

	assert.deepEqual(canonical.messages[0], {
		role: "tool",
		toolCallId: "toolu_1",
		toolResultError: true,
		content: [
			{ type: "text", text: "capture failed" },
			{ type: "image", url: "data:image/png;base64,AAAA" },
		],
	});
});

test("request->canonical: native tools retain their exact Messages definitions", () => {
	const tools = [
		{ type: "web_search_20250305", name: "web_search", max_uses: 3 },
		{
			name: "weather",
			description: "Get weather",
			input_schema: { type: "object", properties: {} },
		},
	];
	const canonical = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 50,
			messages: [{ role: "user", content: "Search" }],
			tools,
		}),
	);

	assert.equal(canonical.requiresNativeWire, true);
	assert.deepEqual(canonical.messagesTransport?.rawTools, tools);
	assert.deepEqual(
		canonical.tools?.map((tool) => tool.name),
		["web_search", "weather"],
	);
});

test("request->canonical: LiteLLM provider_specific_fields restore tool_use state", () => {
	const u = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 50,
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tu_1",
							name: "f",
							input: { x: 1 },
							provider_specific_fields: { thought_signature: "sig-a" },
						},
						{
							type: "tool_use",
							id: "tu_2__thought__sig-b",
							name: "f",
							input: { x: 2 },
						},
					],
				},
			],
		}),
	);
	assert.deepEqual(u.messages[0]!.toolCalls?.[0]?.extraContent, {
		google: { thought_signature: "sig-a" },
	});
	assert.deepEqual(u.messages[0]!.toolCalls?.[1]?.extraContent, {
		google: { thought_signature: "sig-b" },
	});
});

test("request->canonical: image block -> data URL; tools/tool_choice", () => {
	const u = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 50,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "image",
							source: { type: "base64", media_type: "image/png", data: "AAAA" },
						},
					],
				},
			],
			tools: [
				{ name: "f", description: "d", input_schema: { type: "object" } },
			],
			tool_choice: { type: "any" },
		}),
	);
	assert.deepEqual(u.messages[0]!.content, [
		{ type: "image", url: "data:image/png;base64,AAAA" },
	]);
	assert.equal(u.tools?.[0]?.name, "f");
	assert.deepEqual(u.tools?.[0]?.parameters, { type: "object" });
	assert.equal(u.toolChoice, "required");
});

test("request->canonical: thinking budget and output_config.effort are normalized", () => {
	const legacy = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 100,
			thinking: { type: "enabled", budget_tokens: 10_000, display: "omitted" },
			messages: [{ role: "user", content: "hello" }],
		}),
	);
	assert.deepEqual(legacy.reasoning, {
		effort: "medium",
		summary: "none",
		display: "omitted",
	});

	const effort = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 100,
			thinking: { type: "adaptive" },
			output_config: { effort: "low" },
			messages: [{ role: "user", content: "hello" }],
			top_k: 40,
		}),
	);
	assert.deepEqual(effort.reasoning, { effort: "low", summary: "auto" });
	assert.equal(effort.topK, 40);

	const maximum = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 100,
			thinking: { type: "adaptive" },
			output_config: { effort: "max" },
			messages: [{ role: "user", content: "hello" }],
		}),
	);
	assert.deepEqual(maximum.reasoning, { effort: "max", summary: "auto" });
});

test("request->canonical: output_config.format becomes canonical format", () => {
	const schema = {
		type: "object",
		properties: { answer: { type: "string" } },
		required: ["answer"],
	};
	const u = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 100,
			messages: [{ role: "user", content: "hello" }],
			output_config: { effort: "low", format: { type: "json_schema", schema } },
		}),
	);
	assert.deepEqual(u.responseFormat, { type: "json_schema", schema });
	assert.deepEqual(u.reasoning, { effort: "low", summary: "auto" });
});

test("request->canonical: extra_body cannot overwrite messages managed parameters", () => {
	assert.throws(
		() =>
			messagesRequestToCanonical(
				parse({
					model: "claude",
					max_tokens: 100,
					messages: [{ role: "user", content: "hello" }],
					extra_body: { thinking: { type: "disabled" } },
				}),
			),
		/extra_body.thinking/,
	);
});

test("canonical->response: content blocks + stop_reason + usage", () => {
	const resp: CanonicalChatResponse = {
		id: "msg_1",
		created: 1,
		model: "claude-x",
		choices: [
			{
				index: 0,
				finishReason: "stop",
				message: {
					role: "assistant",
					content: "hello",
					reasoning: "Penbe brief.",
					providerFields: {
						anthropic: {
							thinking_blocks: [
								{
									type: "thinking",
									thinking: "Penbe brief.",
									signature: "sig-1",
								},
							],
						},
					},
				},
			},
		],
		usage: { promptTokens: 5, completionTokens: 3, totalTokens: 8 },
	};
	const out = canonicalToMessagesResponse(resp, opts) as TestJsonObject;
	assert.equal(out.type, "message");
	assert.equal(out.role, "assistant");
	assert.equal(out.model, opts.publicModel);
	assert.equal(out.content[0].type, "thinking");
	assert.equal(out.content[0].thinking, "Penbe brief.");
	assert.equal(out.content[0].signature, "sig-1");
	assert.equal(out.content[1].type, "text");
	assert.equal(out.content[1].text, "hello");
	assert.equal(out.stop_reason, "end_turn");
	assert.equal(out.usage.input_tokens, 5);
	assert.equal(out.usage.output_tokens, 3);
	// Anthropic always includes cache fields (0 by default).
	assert.equal(out.usage.cache_creation_input_tokens, 0);
	assert.equal(out.usage.cache_read_input_tokens, 0);
});

test("canonical->response: reconstructs Anthropic disjoint input buckets", () => {
	const resp: CanonicalChatResponse = {
		id: "m",
		created: 1,
		model: "claude",
		choices: [
			{
				index: 0,
				finishReason: "stop",
				message: { role: "assistant", content: "ok" },
			},
		],
		// canonical promptTokens INCLUDES read+write; the render must subtract them for input_tokens.
		usage: {
			promptTokens: 15,
			completionTokens: 3,
			totalTokens: 18,
			cacheReadTokens: 2,
			cacheWriteTokens: 3,
		},
	};
	const out = canonicalToMessagesResponse(resp, opts) as TestJsonObject;
	assert.equal(out.usage.input_tokens, 10); // 15 - 2 - 3
	assert.equal(out.usage.cache_read_input_tokens, 2);
	assert.equal(out.usage.cache_creation_input_tokens, 3);
	assert.equal(out.usage.output_tokens, 3);
});

test("canonical->response: portable reasoning becomes an unsigned thinking block", () => {
	const out = canonicalToMessagesResponse(
		{
			id: "response-1",
			created: 1,
			model: "upstream",
			choices: [
				{
					index: 0,
					finishReason: "stop",
					message: {
						role: "assistant",
						reasoning: "Check the constraints.",
						content: "Done.",
					},
				},
			],
			usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
		},
		opts,
	) as TestJsonObject;

	assert.deepEqual(out.content.slice(0, 2), [
		{
			type: "thinking",
			thinking: "Check the constraints.",
			signature: "",
		},
		{ type: "text", text: "Done." },
	]);
});

test("canonical->response: tool_calls -> tool_use; finish tool_calls -> tool_use", () => {
	const resp: CanonicalChatResponse = {
		id: "m",
		created: 1,
		model: "claude-x",
		choices: [
			{
				index: 0,
				finishReason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					toolCalls: [
						{
							id: "tu_1",
							name: "f",
							arguments: '{"x":1}',
							extraContent: {
								google: { thought_signature: "sig-a" },
							},
						},
					],
				},
			},
		],
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
	};
	const out = canonicalToMessagesResponse(resp, opts) as TestJsonObject;
	assert.equal(out.stop_reason, "tool_use");
	const tu = out.content.find((block) => block.type === "tool_use");
	assert.ok(tu);
	assert.equal(tu.name, "f");
	assert.deepEqual(tu.input, { x: 1 });
	assert.deepEqual(tu.provider_specific_fields, {
		thought_signature: "sig-a",
	});
});

test("stream->events: Anthropic sequence for text", async () => {
	async function* chunks(): AsyncGenerator<CanonicalChatStreamChunk> {
		yield {
			id: "c",
			created: 1,
			model: "claude-x",
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: "Hel" },
					finishReason: null,
				},
			],
		};
		yield {
			id: "c",
			created: 1,
			model: "claude-x",
			choices: [{ index: 0, delta: { content: "lo" }, finishReason: "stop" }],
			usage: {
				promptTokens: 7,
				completionTokens: 1,
				totalTokens: 8,
				cacheReadTokens: 2,
				cacheWriteTokens: 1,
			},
		};
	}
	const types: string[] = [];
	let deltaUsage: TestJsonObject | undefined;
	let streamModel: unknown;
	for await (const ev of canonicalChunksToMessagesEvents(chunks(), opts)) {
		types.push(ev.event!);
		if (ev.event === "message_start")
			streamModel = (JSON.parse(ev.data) as { message: { model: unknown } })
				.message.model;
		if (ev.event === "message_delta")
			deltaUsage = (JSON.parse(ev.data) as { usage: TestJsonObject }).usage;
	}
	assert.deepEqual(types, [
		"message_start",
		"ping",
		"content_block_start",
		"content_block_delta",
		"content_block_delta",
		"content_block_stop",
		"message_delta",
		"message_stop",
	]);
	assert.equal(streamModel, opts.publicModel);
	assert.ok(deltaUsage);
	assert.equal(deltaUsage.output_tokens, 1);
	assert.equal(deltaUsage.input_tokens, 4);
	assert.equal(deltaUsage.cache_read_input_tokens, 2);
	assert.equal(deltaUsage.cache_creation_input_tokens, 1);
});

test("stream->events: Anthropic tool_use includes provider_specific_fields", async () => {
	async function* chunks(): AsyncGenerator<CanonicalChatStreamChunk> {
		yield {
			id: "c",
			created: 1,
			model: "claude-x",
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						toolCalls: [
							{
								index: 0,
								id: "tu_1",
								name: "f",
								arguments: '{"x":1}',
								extraContent: {
									google: { thought_signature: "sig-a" },
								},
							},
						],
					},
					finishReason: "tool_calls",
				},
			],
			usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
		};
	}
	let toolUse: TestJsonObject | undefined;
	for await (const ev of canonicalChunksToMessagesEvents(chunks(), opts)) {
		if (ev.event === "content_block_start") {
			const data = JSON.parse(ev.data) as { content_block: TestJsonObject };
			if (data.content_block.type === "tool_use") toolUse = data.content_block;
		}
	}
	assert.ok(toolUse);
	assert.deepEqual(toolUse.provider_specific_fields, {
		thought_signature: "sig-a",
	});
});

test("request->canonical: strips embedded signatures from tool_use ids and tool_result references", () => {
	const u = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 10,
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_1__thought__sig-a",
							name: "f",
							input: {},
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "toolu_1__thought__sig-a",
							content: "ok",
						},
					],
				},
			],
		}),
	);
	assert.equal(u.messages[0]!.toolCalls?.[0]?.id, "toolu_1");
	assert.deepEqual(u.messages[0]!.toolCalls?.[0]?.extraContent, {
		google: { thought_signature: "sig-a" },
	});
	assert.equal(u.messages[1]!.toolCallId, "toolu_1");
});

test("canonical->response: tool_use id carries the embedded signature", () => {
	const resp: CanonicalChatResponse = {
		id: "x",
		created: 1,
		model: "claude-x",
		choices: [
			{
				index: 0,
				finishReason: "tool_calls",
				message: {
					role: "assistant",
					content: null,
					toolCalls: [
						{
							id: "toolu_1",
							name: "f",
							arguments: "{}",
							extraContent: { google: { thought_signature: "sig-a" } },
						},
					],
				},
			},
		],
		usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
	};
	const out = canonicalToMessagesResponse(resp, opts) as TestJsonObject;
	const toolUse = out.content.find((block) => block.type === "tool_use");
	assert.ok(toolUse);
	assert.equal(toolUse.id, "toolu_1__thought__sig-a");
	assert.deepEqual(toolUse.provider_specific_fields, {
		thought_signature: "sig-a",
	});
});

test("stream->events: content_block_start tool_use id carries the embedded signature", async () => {
	async function* chunks(): AsyncGenerator<CanonicalChatStreamChunk> {
		yield {
			id: "c",
			created: 1,
			model: "claude-x",
			choices: [
				{
					index: 0,
					delta: {
						role: "assistant",
						toolCalls: [
							{
								index: 0,
								id: "toolu_1",
								name: "f",
								arguments: "{}",
								extraContent: { google: { thought_signature: "sig-a" } },
							},
						],
					},
					finishReason: "tool_calls",
				},
			],
		};
	}
	let started: TestJsonObject | undefined;
	for await (const ev of canonicalChunksToMessagesEvents(chunks(), opts)) {
		if (ev.event === "content_block_start") {
			const d = JSON.parse(ev.data) as { content_block?: TestJsonObject };
			if (d.content_block?.type === "tool_use") started = d.content_block;
		}
	}
	assert.ok(started);
	assert.equal(started.id, "toolu_1__thought__sig-a");
});

test("request->canonical: thinking and redacted blocks remain message-bound state", () => {
	const canonical = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 100,
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "plan", signature: "sig-1" },
						{ type: "redacted_thinking", data: "opaque-1" },
						{ type: "tool_use", id: "toolu_1", name: "f", input: {} },
					],
				},
			],
		}),
	);
	assert.deepEqual(canonical.messages[0]?.providerFields, {
		anthropic: {
			thinking_blocks: [
				{ type: "thinking", thinking: "plan", signature: "sig-1" },
				{ type: "redacted_thinking", data: "opaque-1" },
			],
		},
	});
	assert.equal(canonical.requiresNativeWire, true);
});

test("stream->events: native thinking emits its real signature delta", async () => {
	async function* chunks(): AsyncGenerator<CanonicalChatStreamChunk> {
		yield {
			id: "c",
			created: 1,
			model: "claude-x",
			choices: [
				{
					index: 0,
					delta: {
						providerFields: { anthropic: { thinking_stream: true } },
					},
					finishReason: null,
				},
			],
		};
		yield {
			id: "c",
			created: 1,
			model: "claude-x",
			choices: [
				{
					index: 0,
					delta: { reasoning: "plan" },
					finishReason: null,
				},
			],
		};
		yield {
			id: "c",
			created: 1,
			model: "claude-x",
			choices: [
				{
					index: 0,
					delta: {
						providerFields: {
							anthropic: {
								thinking_blocks: [
									{
										type: "thinking",
										thinking: "plan",
										signature: "sig-1",
									},
								],
							},
						},
					},
					finishReason: "stop",
				},
			],
		};
	}
	const deltas: unknown[] = [];
	for await (const event of canonicalChunksToMessagesEvents(chunks(), opts)) {
		if (event.event === "content_block_delta")
			deltas.push(JSON.parse(event.data).delta);
	}
	assert.deepEqual(deltas, [
		{ type: "thinking_delta", thinking: "plan" },
		{ type: "signature_delta", signature: "sig-1" },
	]);
});

test("stream->events: portable interleaved reasoning never overlaps blocks", async () => {
	async function* chunks(): AsyncGenerator<CanonicalChatStreamChunk> {
		for (const delta of [
			{ content: "Answer" },
			{ reasoning: "Recheck" },
			{ content: " complete" },
		]) {
			yield {
				id: "c",
				created: 1,
				model: "upstream",
				choices: [{ index: 0, delta, finishReason: null }],
			};
		}
	}

	const lifecycle: string[] = [];
	for await (const event of canonicalChunksToMessagesEvents(chunks(), opts)) {
		if (
			event.event !== "content_block_start" &&
			event.event !== "content_block_stop"
		)
			continue;
		const data = JSON.parse(event.data) as {
			index: number;
			content_block?: { type?: string };
		};
		lifecycle.push(
			`${event.event}:${data.index}:${data.content_block?.type ?? ""}`,
		);
	}

	assert.deepEqual(lifecycle, [
		"content_block_start:0:text",
		"content_block_stop:0:",
		"content_block_start:1:thinking",
		"content_block_stop:1:",
		"content_block_start:2:text",
		"content_block_stop:2:",
	]);
});

test("request->canonical: unsigned portable thinking does not anchor replay", () => {
	const canonical = messagesRequestToCanonical(
		parse({
			model: "claude",
			max_tokens: 50,
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "portable", signature: "" },
						{ type: "text", text: "answer" },
					],
				},
			],
		}),
	);

	assert.equal(canonical.messages[0]?.providerFields, undefined);
	assert.equal(canonical.requiresNativeWire, undefined);
});
