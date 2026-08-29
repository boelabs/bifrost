// Public contracts (request->canonical and canonical->render) - the canonical "hub".

import { messagesRequestSchema } from "#contracts/anthropic/messages.ts";
import { responsesRequestSchema } from "#contracts/openai/responses.ts";
import { jsonResponse, withStubbedFetch } from "#test-support/fetch.ts";
import type { CanonicalChatStreamChunk } from "#core/canonical.ts";
import { googleAdapter } from "#adapters/google/index.ts";
import { openaiAdapter } from "#adapters/openai/index.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { executeChat } from "#gateway/executor.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

interface TestJsonObject extends Record<string, unknown> {
	content: [TestJsonObject, ...TestJsonObject[]];
	output: TestJsonObject[];
	usage: TestJsonObject;
}

import {
	canonicalChunksToResponsesEvents,
	canonicalToResponsesResponse,
	responsesRequestToCanonical,
} from "#contracts/openai/responsesRender.ts";

import {
	toCanonicalChatRequest,
	toOpenAIChatResponse,
	chatRequestSchema,
	toOpenAIChatChunk,
} from "#contracts/openai/chat.ts";

import {
	canonicalToMessagesResponse,
	messagesRequestToCanonical,
} from "#contracts/anthropic/messagesRender.ts";

/**
 * INTEGRATION tests for the pipeline, hermetic (no DB/Redis/real network): they stub `fetch`
 * and exercise public-request -> canonical -> executeChat(real adapter) -> public-render.
 * Demonstrate the agnostic guarantee: any provider can serve any contract.
 */

const googleCtx: AdapterContext = {
	upstreamModel: "gemini-2.5-flash",
	credentials: { apiKey: "AIza-test" },
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: false,
			structuredOutputs: true,
		},
	},
	transport: "generate_content",
	requestId: "it",
};

const openaiCtx: AdapterContext = {
	upstreamModel: "gpt-5.5",
	credentials: { apiKey: "sk-test" },
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: false,
			structuredOutputs: true,
		},
	},
	transport: "responses",
	requestId: "it",
};

const GEMINI_JSON = {
	candidates: [
		{
			content: { role: "model", parts: [{ text: "Hello from Gemini" }] },
			finishReason: "STOP",
			index: 0,
		},
	],
	usageMetadata: {
		promptTokenCount: 4,
		candidatesTokenCount: 3,
		totalTokenCount: 7,
	},
	modelVersion: "gemini-2.5-flash",
};

const OPENAI_RESPONSES_JSON = {
	id: "resp_up",
	created_at: 1700000000,
	model: "gpt-5.5",
	status: "completed",
	output: [
		{
			type: "message",
			role: "assistant",
			content: [{ type: "output_text", text: "Hello from OpenAI" }],
		},
	],
	usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 },
};

test("integration: structured outputs cross the three public transports", () => {
	const schema = {
		type: "object",
		properties: { answer: { type: "string" } },
		required: ["answer"],
	};

	const fromChat = toCanonicalChatRequest(
		chatRequestSchema.parse({
			model: "grp",
			messages: [{ role: "user", content: "hello" }],
			response_format: {
				type: "json_schema",
				json_schema: { name: "answer", schema, strict: true },
			},
		}),
	);
	assert.deepEqual(
		JSON.parse(openaiAdapter.chat!.buildRequest(fromChat, openaiCtx).body!).text
			.format,
		{
			type: "json_schema",
			name: "answer",
			schema,
			strict: true,
		},
	);

	const fromResponses = responsesRequestToCanonical(
		responsesRequestSchema.parse({
			model: "grp",
			input: "hello",
			text: {
				format: { type: "json_schema", name: "answer", schema, strict: true },
			},
		}),
	);
	const geminiBody = JSON.parse(
		googleAdapter.chat!.buildRequest(fromResponses, googleCtx).body!,
	);
	assert.equal(
		geminiBody.generationConfig.responseMimeType,
		"application/json",
	);
	assert.deepEqual(geminiBody.generationConfig.responseJsonSchema, schema);

	const fromMessages = messagesRequestToCanonical(
		messagesRequestSchema.parse({
			model: "grp",
			max_tokens: 64,
			messages: [{ role: "user", content: "hello" }],
			output_config: { format: { type: "json_schema", schema } },
		}),
	);
	assert.deepEqual(
		JSON.parse(openaiAdapter.chat!.buildRequest(fromMessages, openaiCtx).body!)
			.text.format,
		{
			type: "json_schema",
			name: "structured_output",
			schema,
		},
	);
});

test("integration: one Gemini upstream feeds all 3 public contracts (json)", async () => {
	// Same request (OpenAI chat) -> canonical -> Gemini; the resulting canonical output renders to all 3.
	const canonical = toCanonicalChatRequest(
		chatRequestSchema.parse({
			model: "grp",
			messages: [{ role: "user", content: "hello" }],
		}),
	);

	await withStubbedFetch(
		() => jsonResponse(GEMINI_JSON),
		async () => {
			const result = await executeChat(googleAdapter, canonical, googleCtx);
			assert.equal(result.kind, "json");
			if (result.kind !== "json") return;
			const u = result.response;

			// Render a /v1/chat/completions
			const chat = toOpenAIChatResponse(u, "grp");
			assert.equal(chat.object, "chat.completion");
			assert.equal(chat.model, "grp");
			assert.equal(chat.choices[0]!.message.content, "Hello from Gemini");

			// Render a /v1/responses
			const resp = canonicalToResponsesResponse(u, {
				req: { model: "grp" } as never,
				publicModel: "grp",
			}) as TestJsonObject;
			assert.equal(resp.object, "response");
			assert.equal(resp.model, "grp");
			assert.equal(resp.output_text, "Hello from Gemini");

			// Render a /v1/messages (Anthropic)
			const msg = canonicalToMessagesResponse(u, {
				publicModel: "grp",
			}) as TestJsonObject;
			assert.equal(msg.type, "message");
			assert.equal(msg.model, "grp");
			assert.equal(msg.content[0].text, "Hello from Gemini");
			assert.equal(msg.usage.input_tokens, 4);
		},
	);
});

test("integration: /v1/responses request served by Google (non-OpenAI) and rendered back", async () => {
	const canonical = responsesRequestToCanonical(
		responsesRequestSchema.parse({ model: "grp", input: "hello" }),
	);
	await withStubbedFetch(
		() => jsonResponse(GEMINI_JSON),
		async () => {
			const result = await executeChat(googleAdapter, canonical, googleCtx);
			assert.equal(result.kind, "json");
			if (result.kind !== "json") return;
			const out = canonicalToResponsesResponse(result.response, {
				req: responsesRequestSchema.parse({ model: "grp", input: "hello" }),
				publicModel: "grp",
			}) as TestJsonObject;
			assert.equal(out.output_text, "Hello from Gemini");
			assert.equal(out.usage.input_tokens, 4);
		},
	);
});

test("integration: /v1/messages request served by OpenAI (/responses transport) and rendered to Anthropic", async () => {
	const canonical = messagesRequestToCanonical(
		messagesRequestSchema.parse({
			model: "grp",
			max_tokens: 64,
			messages: [{ role: "user", content: "hello" }],
		}),
	);
	await withStubbedFetch(
		() => jsonResponse(OPENAI_RESPONSES_JSON),
		async () => {
			const result = await executeChat(openaiAdapter, canonical, openaiCtx);
			assert.equal(result.kind, "json");
			if (result.kind !== "json") return;
			const msg = canonicalToMessagesResponse(result.response, {
				publicModel: "grp",
			}) as TestJsonObject;
			assert.equal(msg.content[0].text, "Hello from OpenAI");
			assert.equal(msg.stop_reason, "end_turn");
			assert.equal(msg.usage.output_tokens, 3);
		},
	);
});

test("integration: streaming Gemini -> /v1/responses events and /v1/chat chunks", async () => {
	const sse =
		`data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"},"index":0}]}\n\n` +
		`data: {"candidates":[{"content":{"parts":[{"text":"lo"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5}}\n\n`;

	const canonical = toCanonicalChatRequest(
		chatRequestSchema.parse({
			model: "grp",
			stream: true,
			messages: [{ role: "user", content: "hello" }],
		}),
	);

	await withStubbedFetch(
		() => new Response(sse, { status: 200 }),
		async () => {
			const result = await executeChat(googleAdapter, canonical, googleCtx);
			assert.equal(result.kind, "stream");
			if (result.kind !== "stream") return;

			// Reusing the same canonical stream for two renders requires materializing it.
			const chunks: CanonicalChatStreamChunk[] = [];
			for await (const ch of result.chunks) chunks.push(ch);
			assert.equal(
				chunks.map((c) => c.choices[0]?.delta.content ?? "").join(""),
				"Hello",
			);

			// -> /v1/chat/completions chunks
			const chatChunks = chunks.map((chunk) => toOpenAIChatChunk(chunk, "grp"));
			assert.equal(chatChunks[0]!.object, "chat.completion.chunk");
			assert.equal(
				chatChunks.map((c) => c.choices[0]?.delta.content ?? "").join(""),
				"Hello",
			);

			// -> /v1/responses events
			async function* replay() {
				for (const c of chunks) yield c;
			}
			const types: string[] = [];
			let total: number | undefined;
			for await (const ev of canonicalChunksToResponsesEvents(replay(), {
				req: { model: "grp" } as never,
				publicModel: "grp",
			})) {
				if (ev.event) types.push(ev.event);
				if (ev.event === "response.completed")
					total = JSON.parse(ev.data).response.usage.total_tokens;
			}
			assert.ok(types.includes("response.created"));
			assert.ok(types.includes("response.output_text.delta"));
			assert.equal(types.at(-1), "response.completed");
			assert.equal(total, 5);
		},
	);
});

test("integration: upstream errors translate to GatewayError by class", async () => {
	const canonical = toCanonicalChatRequest(
		chatRequestSchema.parse({
			model: "grp",
			messages: [{ role: "user", content: "hello" }],
		}),
	);

	await withStubbedFetch(
		() => jsonResponse({ error: { message: "slow down" } }, 429),
		async () => {
			await assert.rejects(
				() => executeChat(googleAdapter, canonical, googleCtx),
				(err) => GatewayError.is(err) && err.class === "rate_limit",
			);
		},
	);

	await withStubbedFetch(
		() =>
			jsonResponse(
				{ error: { code: "context_length_exceeded", message: "too long" } },
				400,
			),
		async () => {
			await assert.rejects(
				() => executeChat(openaiAdapter, canonical, openaiCtx),
				(err) => GatewayError.is(err) && err.class === "context_window",
			);
		},
	);
});
