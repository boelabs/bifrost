import { buildResponsesRequestBody } from "#contracts/openai/responsesTransport.ts";
import type { MessageStateDiscardReason } from "#core/providerSpecificFields.ts";
import { buildOpenAIChatBody } from "#contracts/openai/chatTransport.ts";
import { responsesRequestSchema } from "#contracts/openai/responses.ts";
import { jsonBody, must, streamOf } from "#test-support/adapters.ts";
import { anthropicAdapter } from "#adapters/anthropic/index.ts";
import { createMessageStateCodec } from "./messageState.ts";
import { googleAdapter } from "#adapters/google/index.ts";
import type { AdapterContext } from "#adapters/types.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	canonicalChunksToResponsesEvents,
	canonicalToResponsesResponse,
	responsesRequestToCanonical,
} from "#contracts/openai/responsesRender.ts";

type Item = Record<string, unknown>;

const ctx: AdapterContext = {
	upstreamModel: "claude-sonnet-4-5",
	credentials: { apiKey: "sk-ant-test" },
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
		reasoning: {
			kind: "anthropic_budget",
			levels: ["low", "high"],
			budgets: { low: 1024, high: 8192 },
		},
	},
	transport: "messages",
	requestId: "t",
};
const chat = must(anthropicAdapter, "chat");
const INCLUDE = ["reasoning.encrypted_content"];

function recordingCodec() {
	const discarded: MessageStateDiscardReason[] = [];
	return {
		codec: createMessageStateCodec((reason) => discarded.push(reason)),
		discarded,
	};
}

function request(body: Item) {
	return responsesRequestSchema.parse({ model: "claude", ...body });
}

function claudeTurn(content: Item[]) {
	return {
		id: "msg_upstream",
		type: "message",
		role: "assistant",
		model: "claude-sonnet-4-5",
		stop_reason: content.some((block) => block.type === "tool_use")
			? "tool_use"
			: "end_turn",
		content,
		usage: { input_tokens: 1, output_tokens: 1 },
	};
}

function render(raw: unknown): Item[] {
	return canonicalToResponsesResponse(chat.parseResponse(raw, ctx), {
		req: request({ input: "hi", include: INCLUDE }),
		publicModel: "claude",
		reasoningEffort: "high",
		messageState: recordingCodec().codec,
	}).output as Item[];
}

/** Output items as the Vercel AI SDK replays them with `store: false`. */
function aiSdkReplay(output: Item[]): Item[] {
	return output.flatMap((item): Item[] => {
		if (item.type === "message") {
			return [{ role: "assistant", id: item.id, content: item.content }];
		}
		if (item.type === "function_call") {
			return [
				{
					type: "function_call",
					call_id: item.call_id,
					name: item.name,
					arguments: item.arguments,
				},
			];
		}
		return item.type === "reasoning" &&
			typeof item.encrypted_content === "string"
			? [
					{
						type: "reasoning",
						id: item.id,
						encrypted_content: item.encrypted_content,
						summary: [],
					},
				]
			: [];
	});
}

function user(text: string): Item {
	return { role: "user", content: [{ type: "input_text", text }] };
}

function toolOutput(callId: string): Item {
	return { type: "function_call_output", call_id: callId, output: "ok" };
}

function canonicalOf(input: Item[], codec = recordingCodec().codec) {
	return responsesRequestToCanonical(
		request({
			input,
			store: false,
			include: INCLUDE,
			reasoning: { effort: "high" },
		}),
		{ messageState: codec },
	);
}

function claudeBody(input: Item[], codec = recordingCodec().codec) {
	return jsonBody(chat.buildRequest(canonicalOf(input, codec), ctx));
}

const toolOnly = [
	{ type: "thinking", thinking: "I should search.", signature: "sig-1" },
	{ type: "tool_use", id: "toolu_1", name: "search", input: { q: "x" } },
];

const interleaved = [
	{ type: "thinking", thinking: "Plan.", signature: "sig-1" },
	{ type: "text", text: "Voy." },
	{ type: "thinking", thinking: "", signature: "sig-2" },
	{ type: "text", text: " Busco." },
	{ type: "redacted_thinking", data: "opaque" },
	{ type: "tool_use", id: "toolu_1", name: "search", input: { q: "x" } },
];

test("anthropic state: a tool-only turn carries its thinking after its function call", () => {
	const output = render(claudeTurn(toolOnly));
	assert.deepEqual(
		output.map((item) => item.type),
		["reasoning", "function_call", "reasoning"],
	);
	assert.ok(String(output[2]?.encrypted_content).startsWith("bfrs_1."));

	const body = claudeBody([
		user("hi"),
		...aiSdkReplay(output),
		toolOutput("toolu_1"),
	]);
	assert.deepEqual(body.messages[1], { role: "assistant", content: toolOnly });
	assert.equal(body.messages[2].content[0].type, "tool_result");
});

test("anthropic state: the turn replays exactly as returned, as one message", () => {
	const output = render(claudeTurn(interleaved));
	assert.deepEqual(
		output.map((item) => item.type),
		["reasoning", "message", "function_call", "reasoning"],
	);
	const body = claudeBody([
		user("hi"),
		...aiSdkReplay(output),
		toolOutput("toolu_1"),
	]);
	assert.equal(body.messages.length, 3);
	assert.deepEqual(body.messages[1], {
		role: "assistant",
		content: interleaved,
	});
});

test("anthropic state: a streamed turn replays exactly as returned", async () => {
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
			delta: { type: "thinking_delta", thinking: "Plan." },
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
			content_block: {
				type: "tool_use",
				id: "toolu_1",
				name: "search",
				input: {},
			},
		},
		{
			type: "content_block_delta",
			index: 2,
			delta: { type: "input_json_delta", partial_json: '{"q":' },
		},
		{
			type: "content_block_delta",
			index: 2,
			delta: { type: "input_json_delta", partial_json: '"x"}' },
		},
		{ type: "content_block_stop", index: 2 },
		{
			type: "message_delta",
			delta: { stop_reason: "tool_use" },
			usage: { output_tokens: 5 },
		},
		{ type: "message_stop" },
	];
	const sse = events
		.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
		.join("");
	let completed: Item | undefined;
	for await (const event of canonicalChunksToResponsesEvents(
		chat.parseStream(streamOf(sse), ctx),
		{
			req: request({ input: "hi", stream: true, include: INCLUDE }),
			publicModel: "claude",
			reasoningEffort: "high",
			messageState: recordingCodec().codec,
		},
	)) {
		const data = JSON.parse(event.data) as Item;
		if (data.type === "response.completed") {
			completed = data.response as Item;
		}
	}
	const output = completed?.output as Item[];
	assert.deepEqual(
		output.map((item) => item.type),
		["reasoning", "message", "function_call", "reasoning"],
	);
	const body = claudeBody([
		user("hi"),
		...aiSdkReplay(output),
		toolOutput("toolu_1"),
	]);
	assert.deepEqual(body.messages[1], {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "Plan.", signature: "sig-1" },
			{ type: "text", text: "Voy." },
			{ type: "tool_use", id: "toolu_1", name: "search", input: { q: "x" } },
		],
	});
});

test("anthropic state: clients that drop ids anchor to the turn right before", () => {
	const replay = aiSdkReplay(render(claudeTurn(interleaved))).map((item) => {
		const copy = structuredClone(item);
		delete copy.id;
		return copy;
	});
	const body = claudeBody([user("hi"), ...replay, toolOutput("toolu_1")]);
	assert.deepEqual(body.messages[1].content, interleaved);
});

test("anthropic state: an edited turn falls back to the canonical rebuild", () => {
	const replay = aiSdkReplay(render(claudeTurn(interleaved)));
	const edited = replay.map((item) =>
		item.role === "assistant"
			? { ...item, content: [{ type: "output_text", text: "Otra cosa." }] }
			: item,
	);
	const body = claudeBody([user("hi"), ...edited, toolOutput("toolu_1")]);
	assert.deepEqual(
		body.messages[1].content.map((block: Item) => block.type),
		["thinking", "thinking", "redacted_thinking", "text", "tool_use"],
	);
	assert.equal(body.messages[1].content[3].text, "Otra cosa.");
});

test("anthropic state: a lost carrier drops earlier thinking instead of leaving a gap", () => {
	const first = aiSdkReplay(render(claudeTurn(toolOnly)));
	const second = aiSdkReplay(
		render(
			claudeTurn([
				{ type: "thinking", thinking: "Done.", signature: "sig-3" },
				{ type: "text", text: "Listo." },
			]),
		),
	);
	const lost = first.map((item) =>
		item.type === "reasoning"
			? { ...item, encrypted_content: "bfrs_1.tampered" }
			: item,
	);
	const { codec, discarded } = recordingCodec();
	const body = claudeBody(
		[
			user("hi"),
			...first,
			toolOutput("toolu_1"),
			...lost,
			toolOutput("toolu_1"),
			...second,
			user("again"),
		],
		codec,
	);
	assert.deepEqual(discarded, ["undecryptable"]);
	// The first turn's state was valid, but keeping it would leave a gap before the third.
	assert.deepEqual(
		body.messages[1].content.map((block: Item) => block.type),
		["tool_use"],
	);
	assert.deepEqual(
		body.messages[5].content.map((block: Item) => block.type),
		["thinking", "text"],
	);
});

test("anthropic state: never reaches another provider", () => {
	const canonical = canonicalOf([
		user("hi"),
		...aiSdkReplay(render(claudeTurn(interleaved))),
		toolOutput("toolu_1"),
	]);
	const google = must(googleAdapter, "chat").buildRequest(canonical, {
		...ctx,
		upstreamModel: "gemini-3.5-pro",
		credentials: { apiKey: "AIza-test" },
		meta: {
			...ctx.meta,
			reasoning: { kind: "gemini_level", levels: ["low", "high"] },
		},
		transport: "generate_content",
	});
	// OpenAI transports need a reasoning spec of their own; the request's history is what matters.
	const withoutReasoning = structuredClone(canonical);
	delete withoutReasoning.reasoning;
	for (const wire of [
		JSON.stringify(jsonBody(google)),
		JSON.stringify(buildResponsesRequestBody(withoutReasoning, "gpt-x")),
		JSON.stringify(buildOpenAIChatBody(withoutReasoning, "gpt-x")),
	]) {
		assert.equal(wire.includes("sig-1"), false);
		assert.equal(wire.includes("bfrs_"), false);
	}
});
