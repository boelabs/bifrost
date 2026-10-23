import { buildResponsesRequestBody } from "#contracts/openai/responsesTransport.ts";
import type { MessageStateDiscardReason } from "#core/providerSpecificFields.ts";
import { parseResponsesResponse } from "#contracts/openai/responsesTransport.ts";
import { messagesRequestSchema } from "#contracts/anthropic/messages.ts";
import { jsonBody, must, streamOf } from "#test-support/adapters.ts";
import type { CanonicalChatResponse } from "#core/canonical.ts";
import { anthropicAdapter } from "#adapters/anthropic/index.ts";
import { createMessageStateCodec } from "./messageState.ts";
import { googleAdapter } from "#adapters/google/index.ts";
import type { AdapterContext } from "#adapters/types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	canonicalChunksToMessagesEvents,
	canonicalToMessagesResponse,
	messagesRequestToCanonical,
} from "#contracts/anthropic/messagesRender.ts";

type Item = Record<string, unknown>;

const claudeCtx: AdapterContext = {
	upstreamModel: "claude-sonnet-4-5",
	credentials: { apiKey: "sk-ant-test" },
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
	},
	transport: "messages",
	requestId: "t",
};
const geminiCtx: AdapterContext = {
	upstreamModel: "gemini-3.5-pro",
	credentials: { apiKey: "AIza-test" },
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
		reasoning: { kind: "gemini_level", levels: ["low", "high"] },
	},
	transport: "generate_content",
	requestId: "t",
};
const claude = must(anthropicAdapter, "chat");
const gemini = must(googleAdapter, "chat");

function recordingCodec() {
	const discarded: MessageStateDiscardReason[] = [];
	return {
		codec: createMessageStateCodec((reason) => discarded.push(reason)),
		discarded,
	};
}

function render(response: CanonicalChatResponse): Item[] {
	return canonicalToMessagesResponse(response, {
		publicModel: "model",
		messageState: recordingCodec().codec,
	}).content as Item[];
}

/** What an Anthropic SDK client accumulates from a stream. */
async function streamedContent(
	chunks: AsyncIterable<
		Parameters<typeof canonicalChunksToMessagesEvents>[0] extends AsyncIterable<
			infer T
		>
			? T
			: never
	>,
): Promise<Item[]> {
	const blocks: Item[] = [];
	const json = new Map<number, string>();
	for await (const event of canonicalChunksToMessagesEvents(chunks, {
		publicModel: "model",
		messageState: recordingCodec().codec,
	})) {
		const data = JSON.parse(event.data) as Item;
		const index = data.index as number;
		const delta = data.delta as Item | undefined;
		if (data.type === "content_block_start") {
			blocks[index] = structuredClone(data.content_block as Item);
		} else if (data.type === "content_block_delta" && delta) {
			const block = blocks[index] as Item;
			if (delta.type === "text_delta") {
				block.text = `${String(block.text)}${String(delta.text)}`;
			} else if (delta.type === "thinking_delta") {
				block.thinking = `${String(block.thinking)}${String(delta.thinking)}`;
			} else if (delta.type === "signature_delta") {
				block.signature = `${String(block.signature)}${String(delta.signature)}`;
			} else if (delta.type === "input_json_delta") {
				json.set(
					index,
					`${json.get(index) ?? ""}${String(delta.partial_json)}`,
				);
			}
		} else if (data.type === "content_block_stop" && json.has(index)) {
			(blocks[index] as Item).input = JSON.parse(json.get(index) ?? "{}");
		}
	}
	return blocks;
}

function replay(content: Item[], codec = recordingCodec().codec) {
	return messagesRequestToCanonical(
		messagesRequestSchema.parse({
			model: "model",
			max_tokens: 100,
			messages: [
				{ role: "user", content: "find x" },
				{ role: "assistant", content },
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
					],
				},
			],
		}),
		{ messageState: codec },
	);
}

const interleaved = [
	{ type: "thinking", thinking: "Plan.", signature: "sig-1" },
	{ type: "text", text: "Voy." },
	{ type: "thinking", thinking: "", signature: "sig-2" },
	{ type: "text", text: " Busco." },
	{ type: "tool_use", id: "toolu_1", name: "search", input: { q: "x" } },
];

function claudeResponse(content: Item[]) {
	return claude.parseResponse(
		{
			id: "msg_1",
			model: "claude",
			stop_reason: "tool_use",
			content,
			usage: { input_tokens: 1, output_tokens: 1 },
		},
		claudeCtx,
	);
}

test("messages: Claude's turn comes back exactly as returned, and goes back that way", () => {
	const content = render(claudeResponse(interleaved));
	assert.deepEqual(content, interleaved);
	const body = jsonBody(claude.buildRequest(replay(content), claudeCtx));
	assert.deepEqual(body.messages[1], {
		role: "assistant",
		content: interleaved,
	});

	// A client's cache breakpoint rides on its own block.
	const marked = structuredClone(interleaved) as Item[];
	(marked[4] as Item).cache_control = { type: "ephemeral" };
	const cached = jsonBody(claude.buildRequest(replay(marked), claudeCtx));
	assert.deepEqual(cached.messages[1].content, marked);
});

test("messages: a rewritten response falls back to the canonical blocks", () => {
	const response = claudeResponse(interleaved);
	const message = response.choices[0]?.message;
	assert.ok(message);
	message.content = "Rewritten.";
	assert.deepEqual(
		render(response).map((block) => block.type),
		["thinking", "thinking", "text", "tool_use"],
	);
});

test("messages: streamed thinking without visible text keeps its place and signature", async () => {
	const events = [
		{ type: "message_start", message: { id: "msg_1", model: "claude" } },
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "thinking", thinking: "", signature: "" },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "signature_delta", signature: "sig-1" },
		},
		{ type: "content_block_stop", index: 0 },
		{
			type: "content_block_start",
			index: 1,
			content_block: { type: "text", text: "" },
		},
		{
			type: "content_block_delta",
			index: 1,
			delta: { type: "text_delta", text: "Voy." },
		},
		{ type: "content_block_stop", index: 1 },
		{
			type: "content_block_start",
			index: 2,
			content_block: { type: "thinking", thinking: "", signature: "" },
		},
		{
			type: "content_block_delta",
			index: 2,
			delta: { type: "signature_delta", signature: "sig-2" },
		},
		{ type: "content_block_stop", index: 2 },
		{
			type: "content_block_start",
			index: 3,
			content_block: {
				type: "tool_use",
				id: "toolu_1",
				name: "search",
				input: {},
			},
		},
		{
			type: "content_block_delta",
			index: 3,
			delta: { type: "input_json_delta", partial_json: '{"q":"x"}' },
		},
		{ type: "content_block_stop", index: 3 },
		{
			type: "message_delta",
			delta: { stop_reason: "tool_use" },
			usage: { output_tokens: 3 },
		},
		{ type: "message_stop" },
	];
	const sse = events
		.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
		.join("");
	const content = await streamedContent(
		claude.parseStream(streamOf(sse), claudeCtx),
	);
	const expected = [
		{ type: "thinking", thinking: "", signature: "sig-1" },
		{ type: "text", text: "Voy." },
		{ type: "thinking", thinking: "", signature: "sig-2" },
		{ type: "tool_use", id: "toolu_1", name: "search", input: { q: "x" } },
	];
	assert.deepEqual(content, expected);
	const body = jsonBody(claude.buildRequest(replay(content), claudeCtx));
	assert.deepEqual(body.messages[1].content, expected);
});

function geminiResponse() {
	return gemini.parseResponse(
		{
			candidates: [
				{
					index: 0,
					finishReason: "STOP",
					content: {
						parts: [
							{ text: "Busco." },
							{ text: "", thoughtSignature: "sig-text" },
							{
								functionCall: {
									id: "toolu_1",
									name: "search",
									args: { q: "x" },
								},
								thoughtSignature: "sig-fc",
							},
						],
					},
				},
			],
			usageMetadata: {},
		},
		geminiCtx,
	);
}

test("messages: Gemini state rides in a trailing redacted_thinking block", () => {
	const content = render(geminiResponse());
	assert.deepEqual(
		content.map((block) => block.type),
		["text", "tool_use", "redacted_thinking"],
	);
	assert.ok(String(content[2]?.data).startsWith("bfrs_1."));

	const canonical = replay(content);
	// A gateway carrier is not Anthropic state: any provider may serve the next turn.
	assert.notEqual(canonical.requiresNativeWire, true);
	const body = jsonBody(gemini.buildRequest(canonical, geminiCtx));
	assert.deepEqual(body.contents[1], {
		role: "model",
		parts: [
			{ text: "Busco." },
			{ text: "", thoughtSignature: "sig-text" },
			{
				functionCall: { id: "toolu_1", name: "search", args: { q: "x" } },
				thoughtSignature: "sig-fc",
			},
		],
	});
	// Claude never sees it.
	const toClaude = JSON.stringify(
		jsonBody(claude.buildRequest(canonical, claudeCtx)),
	);
	assert.equal(toClaude.includes("bfrs_"), false);
	assert.equal(toClaude.includes("sig-text"), false);
});

test("messages: Gemini's streamed state arrives as the last block", async () => {
	const sse = [
		{ parts: [{ text: "Hola." }] },
		{ parts: [{ text: "", thoughtSignature: "sig-s" }], finishReason: "STOP" },
	]
		.map(
			({ parts, finishReason }) =>
				`data: ${JSON.stringify({
					candidates: [
						{
							index: 0,
							content: { role: "model", parts },
							...(finishReason ? { finishReason } : {}),
						},
					],
				})}\n\n`,
		)
		.join("");
	const content = await streamedContent(
		gemini.parseStream(streamOf(sse), geminiCtx),
	);
	assert.deepEqual(
		content.map((block) => block.type),
		["text", "redacted_thinking"],
	);
	const body = jsonBody(gemini.buildRequest(replay(content), geminiCtx));
	assert.deepEqual(body.contents[1].parts, [
		{ text: "Hola." },
		{ text: "", thoughtSignature: "sig-s" },
	]);
});

test("messages: OpenAI encrypted reasoning round-trips through the carrier", () => {
	const response = parseResponsesResponse({
		id: "resp_1",
		status: "completed",
		model: "gpt",
		output: [
			{
				type: "reasoning",
				id: "rs_1",
				summary: [],
				encrypted_content: "opaque-openai",
			},
			{
				type: "message",
				id: "msg_1",
				role: "assistant",
				content: [{ type: "output_text", text: "Hi.", annotations: [] }],
			},
		],
		usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
	});
	const content = render(response);
	assert.deepEqual(
		content.map((block) => block.type),
		["text", "redacted_thinking"],
	);
	const input = buildResponsesRequestBody(replay(content), "gpt-x")
		.input as Item[];
	assert.deepEqual(
		input.map((item) => item.type ?? item.role),
		["message", "reasoning", "message", "function_call_output"],
	);
	assert.equal(input[1]?.encrypted_content, "opaque-openai");
});

test("messages: edited or unreadable carriers are dropped", () => {
	const content = render(geminiResponse());
	const edited = content.map((block) =>
		block.type === "text" ? { ...block, text: "Otra cosa." } : block,
	);
	const editing = recordingCodec();
	const body = jsonBody(
		gemini.buildRequest(replay(edited, editing.codec), geminiCtx),
	);
	assert.deepEqual(editing.discarded, ["content_mismatch"]);
	assert.deepEqual(body.contents[1].parts[0], { text: "Otra cosa." });

	const tampered = content.map((block) =>
		block.type === "redacted_thinking"
			? { ...block, data: "bfrs_1.nope" }
			: block,
	);
	const reading = recordingCodec();
	const canonical = replay(tampered, reading.codec);
	assert.deepEqual(reading.discarded, ["undecryptable"]);
	assert.equal(JSON.stringify(canonical).includes("bfrs_"), false);
});
