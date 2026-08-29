import type { CanonicalChatRequest } from "#core/canonical.ts";
import { adapterDiagnostics } from "#adapters/diagnostics.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { anthropicAdapter } from "./index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const ctx: AdapterContext = {
	upstreamModel: "claude-sonnet-4-5",
	credentials: { apiKey: "sk-ant-test" },
	meta: {
		maxOutputTokens: 2048,
		capabilities: {
			tools: true,
			vision: true,
			reasoning: false,
			structuredOutputs: true,
		},
	},
	transport: "messages",
	requestId: "t",
};

const adaptiveCtx: AdapterContext = {
	...ctx,
	upstreamModel: "claude-opus-4-8",
	meta: {
		maxOutputTokens: 2048,
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
		reasoning: {
			kind: "anthropic_adaptive",
			levels: ["none", "low", "medium", "high", "xhigh", "max"],
		},
	},
};

const budgetCtx: AdapterContext = {
	...ctx,
	meta: {
		maxOutputTokens: 2048,
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
		reasoning: {
			kind: "anthropic_budget",
			levels: ["none", "low", "medium", "high"],
			budgets: { low: 2048, medium: 8192, high: 16000 },
		},
	},
};

const req: CanonicalChatRequest = {
	callType: "chat",
	model: "claude",
	messages: [
		{ role: "system", content: "Be concise." },
		{ role: "user", content: "Hello" },
	],
	stream: false,
	maxTokens: 128,
};

test("anthropic.buildRequest: messages transport, auth headers and system split", () => {
	const built = anthropicAdapter.chat!.buildRequest(req, ctx);
	assert.equal(built.method, "POST");
	assert.equal(built.url, "https://api.anthropic.com/v1/messages");
	assert.equal(built.headers["x-api-key"], "sk-ant-test");
	assert.equal(built.headers["anthropic-version"], "2023-06-01");
	const body = JSON.parse(built.body!);
	assert.equal(body.model, "claude-sonnet-4-5");
	assert.equal(body.max_tokens, 128);
	assert.equal(body.system, "Be concise.");
	assert.deepEqual(body.messages, [{ role: "user", content: "Hello" }]);
});

test("anthropic.buildRequest: cache_control is emitted in system (array), content, and tools", () => {
	const built = anthropicAdapter.chat!.buildRequest(
		{
			callType: "chat",
			model: "claude",
			stream: false,
			maxTokens: 128,
			messages: [
				{
					role: "system",
					content: [
						{
							type: "text",
							text: "Big preamble",
							cacheControl: { type: "ephemeral" },
						},
					],
				},
				{
					role: "user",
					content: [
						{ type: "text", text: "Hi", cacheControl: { type: "ephemeral" } },
					],
				},
			],
			tools: [
				{
					name: "lookup",
					parameters: { type: "object" },
					cacheControl: { type: "ephemeral" },
				},
			],
		},
		ctx,
	);
	const body = JSON.parse(built.body!);
	// system with cache_control -> array of blocks (not string).
	assert.deepEqual(body.system, [
		{
			type: "text",
			text: "Big preamble",
			cache_control: { type: "ephemeral" },
		},
	]);
	assert.deepEqual(body.messages[0].content, [
		{ type: "text", text: "Hi", cache_control: { type: "ephemeral" } },
	]);
	assert.deepEqual(body.tools[0].cache_control, { type: "ephemeral" });
});

test("anthropic.buildRequest: system without cache_control still flattens to string", () => {
	const built = anthropicAdapter.chat!.buildRequest(
		{
			callType: "chat",
			model: "claude",
			stream: false,
			maxTokens: 128,
			messages: [
				{ role: "system", content: [{ type: "text", text: "Be concise." }] },
				{ role: "user", content: "Hello" },
			],
		},
		ctx,
	);
	const body = JSON.parse(built.body!);
	assert.equal(body.system, "Be concise.");
});

test("anthropic.buildRequest: emits native PDF document sources", () => {
	const built = anthropicAdapter.chat!.buildRequest(
		{
			...req,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "file",
							fileUrl: "https://assets.example/document.pdf",
						},
						{
							type: "file",
							fileData: "data:application/pdf;base64,AAAA",
							cacheControl: { type: "ephemeral" },
						},
					],
				},
			],
		},
		ctx,
	);
	assert.deepEqual(JSON.parse(built.body!).messages[0].content, [
		{
			type: "document",
			source: {
				type: "url",
				url: "https://assets.example/document.pdf",
			},
		},
		{
			type: "document",
			source: {
				type: "base64",
				media_type: "application/pdf",
				data: "AAAA",
			},
			cache_control: { type: "ephemeral" },
		},
	]);
});

test("anthropic.buildRequest: provider file references enable the Files API beta", () => {
	const built = anthropicAdapter.chat!.buildRequest(
		{
			...req,
			messages: [
				{
					role: "user",
					content: [{ type: "file", fileId: "file-123" }],
				},
			],
		},
		ctx,
	);
	assert.equal(built.headers["anthropic-beta"], "files-api-2025-04-14");
	assert.deepEqual(JSON.parse(built.body!).messages[0].content, [
		{
			type: "document",
			source: { type: "file", file_id: "file-123" },
		},
	]);

	const withExistingBeta = anthropicAdapter.chat!.buildRequest(
		{
			...req,
			messages: [
				{
					role: "user",
					content: [{ type: "file", fileId: "file-123" }],
				},
			],
		},
		{
			...ctx,
			credentials: {
				apiKey: "test-key",
				headers: { "Anthropic-Beta": "feature-2026-01-01" },
			},
		},
	);
	assert.equal(
		withExistingBeta.headers["Anthropic-Beta"],
		"feature-2026-01-01,files-api-2025-04-14",
	);
});

test("anthropic.buildRequest: adaptive reasoning keeps xhigh and max distinct", () => {
	const built = anthropicAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "xhigh" }, extraBody: { top_k: 40 } },
		adaptiveCtx,
	);
	const body = JSON.parse(built.body!);
	assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
	assert.deepEqual(body.output_config, { effort: "xhigh" });
	assert.equal(body.top_k, 40);

	const maximum = anthropicAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "max" } },
		adaptiveCtx,
	);
	assert.deepEqual(JSON.parse(maximum.body!).output_config, { effort: "max" });
});

test("anthropic.buildRequest: fast aliases select the native model and required beta", () => {
	const built = anthropicAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "max" } },
		{ ...adaptiveCtx, upstreamModel: "claude-opus-5-fast" },
	);
	const body = JSON.parse(built.body!);
	assert.equal(body.model, "claude-opus-5");
	assert.equal(body.speed, "fast");
	assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
	assert.deepEqual(body.output_config, { effort: "max" });
	assert.equal(built.headers["anthropic-beta"], "fast-mode-2026-02-01");
});

test("anthropic.buildRequest: structured output merges with output_config.effort", () => {
	const schema = {
		type: "object",
		properties: { answer: { type: "string" } },
		required: ["answer"],
	};
	const built = anthropicAdapter.chat!.buildRequest(
		{
			...req,
			reasoning: { effort: "high" },
			responseFormat: { type: "json_schema", schema },
		},
		adaptiveCtx,
	);
	assert.deepEqual(JSON.parse(built.body!).output_config, {
		effort: "high",
		format: { type: "json_schema", schema },
	});
});

test("anthropic.buildRequest: json_object uses an open object schema", () => {
	const built = anthropicAdapter.chat!.buildRequest(
		{ ...req, responseFormat: { type: "json_object" } },
		ctx,
	);
	assert.deepEqual(JSON.parse(built.body!).output_config, {
		format: { type: "json_schema", schema: { type: "object" } },
	});
});

test("anthropic.buildRequest: omitted effort explicitly disables optional adaptive reasoning", () => {
	// Opus 5 reasons when `thinking` is omitted, so canonical `none` must use Anthropic's literal switch.
	const built = anthropicAdapter.chat!.buildRequest(req, adaptiveCtx);
	const body = JSON.parse(built.body!);
	assert.deepEqual(body.thinking, { type: "disabled" });
	assert.equal(body.output_config, undefined);
});

test("anthropic.buildRequest: omitted effort on MANDATORY reasoner -> lowest level + summarized", () => {
	const forcedCtx: AdapterContext = {
		...adaptiveCtx,
		meta: {
			...adaptiveCtx.meta,
			reasoning: {
				kind: "anthropic_adaptive",
				levels: ["low", "medium", "high", "xhigh"],
			},
		},
	};
	const body = JSON.parse(
		anthropicAdapter.chat!.buildRequest(req, forcedCtx).body!,
	);
	assert.deepEqual(body.thinking, { type: "adaptive", display: "summarized" });
	assert.deepEqual(body.output_config, { effort: "low" });
});

test("anthropic.buildRequest: legacy budget uses thinking.enabled and none uses disabled", () => {
	const high = anthropicAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "high" } },
		budgetCtx,
	);
	assert.deepEqual(JSON.parse(high.body!).thinking, {
		type: "enabled",
		budget_tokens: 16000,
		display: "summarized",
	});

	const none = anthropicAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "none" } },
		budgetCtx,
	);
	assert.deepEqual(JSON.parse(none.body!).thinking, { type: "disabled" });
});

test("anthropic.buildRequest: summary none uses omitted display", () => {
	const built = anthropicAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "high", summary: "none" } },
		adaptiveCtx,
	);
	assert.deepEqual(JSON.parse(built.body!).thinking, {
		type: "adaptive",
		display: "omitted",
	});
});

test("anthropic.buildRequest: extraBody does not overwrite managed fields", () => {
	assert.throws(
		() =>
			anthropicAdapter.chat!.buildRequest(
				{ ...req, extraBody: { output_config: { effort: "low" } } },
				adaptiveCtx,
			),
		/extra_body.output_config/,
	);
});

test("anthropic.parseResponse: text and tool_use blocks become canonical output", () => {
	const raw = {
		id: "msg_1",
		model: "claude-sonnet-4-5",
		stop_reason: "tool_use",
		content: [
			{ type: "text", text: "Let me check." },
			{ type: "thinking", thinking: "I should inspect the tool." },
			{
				type: "tool_use",
				id: "toolu_1",
				name: "lookup",
				input: { q: "hello" },
			},
		],
		usage: {
			input_tokens: 10,
			output_tokens: 5,
			cache_read_input_tokens: 2,
			cache_creation_input_tokens: 3,
		},
	};
	const parsed = anthropicAdapter.chat!.parseResponse(raw, ctx);
	assert.equal(parsed.choices[0]!.message.content, "Let me check.");
	assert.equal(
		parsed.choices[0]!.message.reasoning,
		"I should inspect the tool.",
	);
	assert.equal(parsed.choices[0]!.finishReason, "tool_calls");
	assert.equal(
		parsed.choices[0]!.message.toolCalls?.[0]?.arguments,
		'{"q":"hello"}',
	);
	// Anthropic input buckets are disjoint: promptTokens = 10 + 2 (read) + 3 (write) = 15.
	assert.equal(parsed.usage.promptTokens, 15);
	assert.equal(parsed.usage.totalTokens, 20);
	assert.equal(parsed.usage.cacheReadTokens, 2);
	assert.equal(parsed.usage.cacheWriteTokens, 3);
});

test("anthropic.mapError: oversized prompt -> context_window; generic 400 -> bad_request", () => {
	const tooLong = anthropicAdapter.chat!.mapError(
		{
			status: 400,
			body: {
				error: {
					type: "invalid_request_error",
					message: "prompt is too long: 250000 tokens > 200000 maximum",
				},
			},
		},
		ctx,
	);
	assert.equal(tooLong.class, "context_window");

	const generic = anthropicAdapter.chat!.mapError(
		{
			status: 400,
			body: {
				error: {
					type: "invalid_request_error",
					message: "messages: at least one message is required",
				},
			},
		},
		ctx,
	);
	assert.equal(generic.class, "bad_request");
});

test("anthropic.parseStream: text and tool JSON deltas stream as canonical chunks", async () => {
	const sse =
		`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude","usage":{"input_tokens":3,"output_tokens":1},"content":[]}}\n\n` +
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hmm"}}\n\n` +
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n` +
		`event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"lookup","input":{}}}\n\n` +
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":"}}\n\n` +
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":8}}\n\n` +
		`event: message_stop\ndata: {"type":"message_stop"}\n\n`;
	const chunks = [];
	for await (const chunk of anthropicAdapter.chat!.parseStream(
		new Response(sse).body!,
		ctx,
	)) {
		chunks.push(chunk);
	}
	assert.equal(chunks[0]!.choices[0]!.delta.role, "assistant");
	assert.equal(chunks[1]!.choices[0]!.delta.reasoning, "Hmm");
	assert.equal(chunks[2]!.choices[0]!.delta.content, "Hi");
	assert.equal(chunks[3]!.choices[0]!.delta.toolCalls?.[0]?.name, "lookup");
	assert.equal(chunks[4]!.choices[0]!.delta.toolCalls?.[0]?.arguments, '{"q":');
	assert.equal(chunks[5]!.choices[0]!.finishReason, "tool_calls");
	assert.equal(chunks[5]!.usage?.totalTokens, 11);
});

test("anthropic thinking state: signed and redacted blocks survive parse and replay", () => {
	const parsed = anthropicAdapter.chat!.parseResponse(
		{
			id: "msg_1",
			model: "claude",
			stop_reason: "tool_use",
			content: [
				{ type: "thinking", thinking: "plan", signature: "sig-1" },
				{ type: "redacted_thinking", data: "opaque-1" },
				{ type: "tool_use", id: "toolu_1", name: "lookup", input: {} },
			],
			usage: { input_tokens: 2, output_tokens: 3 },
		},
		ctx,
	);
	const message = parsed.choices[0]!.message;
	assert.deepEqual(message.providerFields, {
		anthropic: {
			thinking_blocks: [
				{ type: "thinking", thinking: "plan", signature: "sig-1" },
				{ type: "redacted_thinking", data: "opaque-1" },
			],
		},
	});
	const replay = anthropicAdapter.chat!.buildRequest(
		{
			...req,
			messages: [
				{
					role: "assistant",
					content: null,
					providerFields: message.providerFields!,
					toolCalls: message.toolCalls!,
				},
				{ role: "tool", toolCallId: "toolu_1", content: "ok" },
			],
		},
		ctx,
	);
	const body = JSON.parse(replay.body!);
	assert.deepEqual(body.messages[0].content.slice(0, 2), [
		{ type: "thinking", thinking: "plan", signature: "sig-1" },
		{ type: "redacted_thinking", data: "opaque-1" },
	]);
});

test("anthropic.buildRequest: top_k and metadata use their native fields", () => {
	const built = anthropicAdapter.chat!.buildRequest(
		{
			...req,
			topK: 40,
			messagesTransport: { metadata: { user_id: "user-1" } },
		},
		ctx,
	);
	const body = JSON.parse(built.body!);
	assert.equal(body.top_k, 40);
	assert.deepEqual(body.metadata, { user_id: "user-1" });
});

test("anthropic.parseStream: signature deltas become replayable message state", async () => {
	const sse =
		`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude","usage":{"input_tokens":1},"content":[]}}\n\n` +
		`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n` +
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}\n\n` +
		`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig-1"}}\n\n` +
		`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n` +
		`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n`;
	const fields: unknown[] = [];
	for await (const chunk of anthropicAdapter.chat!.parseStream(
		new Response(sse).body!,
		ctx,
	)) {
		const value = chunk.choices[0]?.delta.providerFields;
		if (value !== undefined) fields.push(value);
	}
	assert.deepEqual(fields.at(-1), {
		anthropic: {
			thinking_blocks: [
				{ type: "thinking", thinking: "plan", signature: "sig-1" },
			],
		},
	});
});

test("anthropic.parseResponse: context-window stop maps to length", () => {
	const parsed = anthropicAdapter.chat!.parseResponse(
		{
			id: "msg_1",
			model: "claude",
			stop_reason: "model_context_window_exceeded",
			content: [{ type: "text", text: "partial" }],
			usage: { input_tokens: 1, output_tokens: 1 },
		},
		ctx,
	);
	assert.equal(parsed.choices[0]?.finishReason, "length");
});

test("anthropic.parseResponse: new stop reasons preserve valid output and diagnostics", () => {
	const parsed = anthropicAdapter.chat!.parseResponse(
		{
			id: "msg_1",
			model: "claude",
			stop_reason: "pause_turn",
			content: [{ type: "text", text: "partial" }],
			usage: { input_tokens: 1, output_tokens: 1 },
		},
		ctx,
	);
	assert.equal(parsed.choices[0]?.finishReason, "stop");
	assert.equal(
		adapterDiagnostics(parsed)?.originalTerminalReason,
		"pause_turn",
	);
});
