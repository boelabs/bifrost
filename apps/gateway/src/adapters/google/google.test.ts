import type { CanonicalEmbeddingsRequest } from "#core/embeddings.ts";
import { observeChatStream } from "#gateway/streamLifecycle.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import { adapterDiagnostics } from "#adapters/diagnostics.ts";
import type { AdapterContext } from "#adapters/types.ts";
import { isUsageConsistent } from "#core/usage.ts";
import { GatewayError } from "#core/errors.ts";
import { googleAdapter } from "./index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

const ctx: AdapterContext = {
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
	requestId: "t",
};

const geminiLevelCtx: AdapterContext = {
	...ctx,
	upstreamModel: "gemini-3.5-flash",
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
		reasoning: {
			kind: "gemini_level",
			levels: ["minimal", "low", "medium", "high"],
		},
	},
};

const geminiBudgetCtx: AdapterContext = {
	...ctx,
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
		reasoning: {
			kind: "gemini_budget",
			levels: ["none", "minimal", "low", "medium", "high"],
			budgets: { minimal: 512, low: 1_024, medium: 4_096, high: 8_192 },
		},
	},
};

const embeddingsCtx: AdapterContext = {
	upstreamModel: "gemini-embedding-001",
	credentials: { apiKey: "AIza-test" },
	meta: {
		capabilities: {
			tools: false,
			vision: false,
			reasoning: false,
			structuredOutputs: false,
		},
		operations: {
			"embedding.create": {
				dimensions: 3072,
				supportsDimensions: true,
				minDimensions: 128,
				maxDimensions: 3072,
				encodingFormats: ["float"],
				maxInputTokens: 2048,
				supportsTokenInput: false,
			},
		},
	},
	transport: "embed_content",
	requestId: "t",
};

const req: CanonicalChatRequest = {
	callType: "chat",
	model: "gemini",
	messages: [
		{ role: "system", content: "You are helpful." },
		{ role: "user", content: "hello" },
	],
	stream: false,
	temperature: 0.4,
	maxTokens: 50,
};

const embeddingsReq: CanonicalEmbeddingsRequest = {
	model: "emb",
	input: "hello",
	encodingFormat: "float",
	dimensions: 768,
	extraBody: {
		embedContentConfig: { taskType: "SEMANTIC_SIMILARITY" },
	},
};

test("google.buildRequest: generateContent URL, api key header, and Gemini body", () => {
	const r = googleAdapter.chat!.buildRequest(req, ctx);
	assert.equal(r.method, "POST");
	assert.equal(
		r.url,
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
	);
	assert.equal(r.headers["x-goog-api-key"], "AIza-test");
	const body = JSON.parse(r.body!);
	assert.equal(body.systemInstruction.parts[0].text, "You are helpful.");
	assert.equal(body.contents[0].role, "user");
	assert.equal(body.contents[0].parts[0].text, "hello");
	assert.equal(body.generationConfig.maxOutputTokens, 50);
	assert.equal(body.generationConfig.temperature, 0.4);
});

test("google embeddings: single input uses embedContent and dimensions config", () => {
	assert.equal(googleAdapter.supportedCallTypes.has("embeddings"), true);
	const handler = googleAdapter.embeddings;
	assert.ok(handler);
	const r = handler.buildRequest(embeddingsReq, embeddingsCtx);
	assert.equal(r.method, "POST");
	assert.equal(
		r.url,
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
	);
	assert.equal(r.headers["x-goog-api-key"], "AIza-test");
	const body = JSON.parse(r.body!);
	assert.equal(body.model, "models/gemini-embedding-001");
	assert.equal(body.content.parts[0].text, "hello");
	assert.equal(body.embedContentConfig.outputDimensionality, 768);
	assert.equal(body.embedContentConfig.taskType, "SEMANTIC_SIMILARITY");
});

test("google embeddings: batch uses batchEmbedContents and parses usage", () => {
	const handler = googleAdapter.embeddings;
	assert.ok(handler);
	const r = handler.buildRequest(
		{
			model: embeddingsReq.model,
			input: ["uno", "dos"],
			encodingFormat: embeddingsReq.encodingFormat,
			dimensions: 768,
		},
		embeddingsCtx,
	);
	assert.equal(
		r.url,
		"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
	);
	const body = JSON.parse(r.body!);
	assert.equal(body.requests.length, 2);
	assert.equal(body.requests[0].model, "models/gemini-embedding-001");
	assert.equal(body.requests[1].content.parts[0].text, "dos");
	assert.equal(body.requests[0].embedContentConfig.outputDimensionality, 768);

	const parsed = handler.parseResponse(
		{
			embeddings: [{ values: [0.1, 0.2] }, { values: [0.3, 0.4] }],
			usageMetadata: { promptTokenCount: 6 },
		},
		embeddingsCtx,
	);
	assert.equal(parsed.model, "gemini-embedding-001");
	assert.deepEqual(parsed.data[0]?.embedding, [0.1, 0.2]);
	assert.deepEqual(parsed.data[1]?.embedding, [0.3, 0.4]);
	assert.deepEqual(parsed.usage, { promptTokens: 6, totalTokens: 6 });
});

test("google.buildRequest: stream uses streamGenerateContent?alt=sse", () => {
	const r = googleAdapter.chat!.buildRequest({ ...req, stream: true }, ctx);
	assert.ok(r.url.endsWith(":streamGenerateContent?alt=sse"));
});

test("google.buildRequest: json_schema uses responseMimeType + responseJsonSchema (Gemini 3 and 2.5)", () => {
	const schema = {
		type: "object",
		properties: { name: { type: "string" }, age: { type: "integer" } },
		required: ["name", "age"],
		additionalProperties: false,
	};
	// The `responseFormat` field does NOT exist in the generateContent API: both generations use
	// responseMimeType + responseJsonSchema (which accepts JSON Schema with lowercase types).
	for (const c of [geminiLevelCtx, ctx]) {
		const body = JSON.parse(
			googleAdapter.chat!.buildRequest(
				{ ...req, responseFormat: { type: "json_schema", schema } },
				c,
			).body!,
		);
		assert.equal(body.generationConfig.responseMimeType, "application/json");
		assert.deepEqual(body.generationConfig.responseJsonSchema, schema);
		assert.equal(body.generationConfig.responseFormat, undefined);
	}
});

test("google.buildRequest: json_object only sets responseMimeType (without schema)", () => {
	const body = JSON.parse(
		googleAdapter.chat!.buildRequest(
			{ ...req, responseFormat: { type: "json_object" } },
			ctx,
		).body!,
	);
	assert.equal(body.generationConfig.responseMimeType, "application/json");
	assert.equal(body.generationConfig.responseJsonSchema, undefined);
});

test("google.buildRequest: tool parameters are translated to Gemini's schema subset", () => {
	const body = JSON.parse(
		googleAdapter.chat!.buildRequest(
			{
				...req,
				tools: [
					{
						name: "get_weather",
						description: "Look up the weather",
						parameters: {
							$schema: "http://json-schema.org/draft-07/schema#",
							type: "object",
							additionalProperties: false,
							properties: { city: { type: "string" } },
							required: ["city"],
						},
					},
				],
			},
			ctx,
		).body!,
	);
	const decl = body.tools[0].functionDeclarations[0];
	assert.equal(decl.name, "get_weather");
	// The fields Gemini rejects are gone; the valid shape is preserved.
	assert.equal(decl.parameters.$schema, undefined);
	assert.equal(decl.parameters.additionalProperties, undefined);
	assert.deepEqual(decl.parameters, {
		type: "object",
		properties: { city: { type: "string" } },
		required: ["city"],
	});
});

test("google.buildRequest: strict Gemini 3 tools use VALIDATED JSON Schema", () => {
	const schema = {
		$schema: "http://json-schema.org/draft-07/schema#",
		type: "object",
		additionalProperties: false,
		properties: {
			queries: {
				type: "array",
				items: {
					type: "object",
					additionalProperties: false,
					properties: { query: { type: "string" } },
					required: ["query"],
				},
			},
		},
		required: ["queries"],
	};
	const choices: Array<CanonicalChatRequest["toolChoice"] | undefined> = [
		undefined,
		"auto",
		{ allowedTools: ["search_web"], mode: "auto" },
	];
	for (const toolChoice of choices) {
		const body = JSON.parse(
			googleAdapter.chat!.buildRequest(
				{
					...req,
					tools: [
						{
							name: "search_web",
							strict: true,
							parameters: schema,
						},
						{
							name: "get_clock",
							strict: false,
							parameters: {
								type: "object",
								additionalProperties: false,
							},
						},
					],
					...(toolChoice !== undefined ? { toolChoice } : {}),
				},
				geminiLevelCtx,
			).body!,
		);
		const declaration = body.tools[0].functionDeclarations[0];
		assert.equal(declaration.parameters, undefined);
		assert.deepEqual(declaration.parametersJsonSchema, {
			type: "object",
			additionalProperties: false,
			properties: {
				queries: {
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						properties: { query: { type: "string" } },
						required: ["query"],
					},
				},
			},
			required: ["queries"],
		});
		assert.equal(body.toolConfig.functionCallingConfig.mode, "VALIDATED");
		const nonStrictDeclaration = body.tools[0].functionDeclarations[1];
		assert.deepEqual(nonStrictDeclaration.parameters, { type: "object" });
		assert.equal(nonStrictDeclaration.parametersJsonSchema, undefined);
		if (typeof toolChoice === "object")
			assert.deepEqual(
				body.toolConfig.functionCallingConfig.allowedFunctionNames,
				["search_web"],
			);
	}
});

test("google.buildRequest: strict mode preserves required tool-choice semantics", () => {
	const choices: NonNullable<CanonicalChatRequest["toolChoice"]>[] = [
		"required",
		{ name: "search_web" },
		{ allowedTools: ["search_web"], mode: "required" },
	];
	for (const toolChoice of choices) {
		const body = JSON.parse(
			googleAdapter.chat!.buildRequest(
				{
					...req,
					tools: [
						{
							name: "search_web",
							strict: true,
							parameters: { type: "object" },
						},
					],
					toolChoice,
				},
				geminiLevelCtx,
			).body!,
		);
		assert.equal(body.toolConfig.functionCallingConfig.mode, "ANY");
	}
});

test("google.buildRequest: non-strict and pre-Gemini-3 requests keep their legacy wire", () => {
	for (const [context, strict] of [
		[geminiLevelCtx, false],
		[ctx, true],
		[{ ...ctx, upstreamModel: "gemma-4-26b-a4b-it" }, true],
	] as const) {
		const body = JSON.parse(
			googleAdapter.chat!.buildRequest(
				{
					...req,
					tools: [
						{
							name: "search_web",
							strict,
							parameters: {
								type: "object",
								additionalProperties: false,
							},
						},
					],
					toolChoice: "auto",
				},
				context,
			).body!,
		);
		const declaration = body.tools[0].functionDeclarations[0];
		assert.deepEqual(declaration.parameters, { type: "object" });
		assert.equal(declaration.parametersJsonSchema, undefined);
		assert.equal(body.toolConfig.functionCallingConfig.mode, "AUTO");
	}

	for (const [context, strict] of [
		[geminiLevelCtx, false],
		[ctx, true],
	] as const) {
		const body = JSON.parse(
			googleAdapter.chat!.buildRequest(
				{
					...req,
					tools: [
						{
							name: "search_web",
							strict,
							parameters: { type: "object" },
						},
					],
				},
				context,
			).body!,
		);
		assert.equal(body.toolConfig, undefined);
	}
});

test("google.buildRequest: replays functionCall id and thought signature", () => {
	const body = JSON.parse(
		googleAdapter.chat!.buildRequest(
			{
				...req,
				messages: [
					{ role: "user", content: "use the tool" },
					{
						role: "assistant",
						content: null,
						toolCalls: [
							{
								id: "function-call-1",
								name: "load_skill",
								arguments: '{"name":"conversation-workspace"}',
								extraContent: {
									google: { thought_signature: "thought-signature-a" },
								},
							},
						],
					},
					{
						role: "tool",
						toolCallId: "function-call-1",
						content: '{"loaded":true}',
					},
				],
			},
			ctx,
		).body!,
	);
	const functionCallPart = body.contents[1].parts[0];
	const functionCall = functionCallPart.functionCall;
	assert.equal(functionCall.id, "function-call-1");
	assert.equal(functionCall.name, "load_skill");
	assert.equal(functionCallPart.thoughtSignature, "thought-signature-a");
	assert.equal(functionCall.thoughtSignature, undefined);
	assert.deepEqual(functionCall.args, { name: "conversation-workspace" });

	const functionResponse = body.contents[2].parts[0].functionResponse;
	assert.equal(functionResponse.id, "function-call-1");
	assert.equal(functionResponse.name, "load_skill");
	assert.deepEqual(functionResponse.response, { loaded: true });
});

test("google.buildRequest: wraps non-object JSON tool outputs in a Struct", () => {
	const cases: [string, unknown][] = [
		['[{"code":"too_big"}]', [{ code: "too_big" }]],
		["null", null],
		['"ok"', "ok"],
		["42", 42],
		["true", true],
	];

	for (const [content, output] of cases) {
		const body = JSON.parse(
			googleAdapter.chat!.buildRequest(
				{
					...req,
					messages: [
						{ role: "user", content: "use the tool" },
						{
							role: "assistant",
							content: null,
							toolCalls: [
								{
									id: "function-call-1",
									name: "load_skill",
									arguments: "{}",
								},
							],
						},
						{
							role: "tool",
							toolCallId: "function-call-1",
							content,
						},
					],
				},
				ctx,
			).body!,
		);

		assert.deepEqual(body.contents[2].parts[0].functionResponse.response, {
			output,
		});
	}
});

test("google.buildRequest: tool execution failures remain ordinary function responses", () => {
	const body = JSON.parse(
		googleAdapter.chat!.buildRequest(
			{
				...req,
				messages: [
					{ role: "user", content: "search" },
					{
						role: "assistant",
						content: null,
						toolCalls: [
							{
								id: "call-1",
								name: "search_web",
								arguments: '{"queries":["example"]}',
							},
						],
					},
					{
						role: "tool",
						toolCallId: "call-1",
						content:
							'{"state":"output-error","errorText":"An error occurred."}',
					},
				],
			},
			ctx,
		).body!,
	);
	assert.deepEqual(body.contents[2].parts[0].functionResponse, {
		id: "call-1",
		name: "search_web",
		response: {
			state: "output-error",
			errorText: "An error occurred.",
		},
	});
});

test("google.buildRequest: Gemini 3 recovers unsigned Responses history", async () => {
	const { responsesRequestSchema } = await import(
		"#contracts/openai/responses.ts"
	);
	const { responsesRequestToCanonical } = await import(
		"#contracts/openai/responsesRender.ts"
	);
	const canonical = responsesRequestToCanonical(
		responsesRequestSchema.parse({
			model: "gemini",
			input: [
				{ role: "user", content: "use the tool" },
				{
					type: "function_call",
					id: "fc-legacy",
					call_id: "legacy-call",
					name: "search_web",
					arguments: '{"query":"latest news"}',
				},
				{
					type: "function_call_output",
					call_id: "legacy-call",
					output: '{"results":[]}',
				},
			],
		}),
	);
	const body = JSON.parse(
		googleAdapter.chat!.buildRequest(canonical, geminiLevelCtx).body!,
	);
	assert.equal(
		body.contents[1].parts[0].thoughtSignature,
		"skip_thought_signature_validator",
	);
});

test("google.buildRequest: older Gemini models do not receive synthetic signatures", () => {
	const body = JSON.parse(
		googleAdapter.chat!.buildRequest(
			{
				...req,
				messages: [
					{
						role: "assistant",
						content: null,
						toolCalls: [{ id: "call-1", name: "f", arguments: "{}" }],
					},
				],
			},
			ctx,
		).body!,
	);
	assert.equal(body.contents[0].parts[0].thoughtSignature, undefined);
});

test("google.buildRequest: Gemini 3 uses thinkingLevel and merges extraBody", () => {
	const r = googleAdapter.chat!.buildRequest(
		{
			...req,
			reasoning: { effort: "xhigh" },
			extraBody: { safetySettings: [] },
		},
		geminiLevelCtx,
	);
	const body = JSON.parse(r.body!);
	assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "high");
	assert.equal(body.generationConfig.thinkingConfig.includeThoughts, true);
	// extra_body.safetySettings overrides the gateway default (shallow extra_body merge wins).
	assert.deepEqual(body.safetySettings, []);
});

test("google.buildRequest: safety filters default to OFF for every category", () => {
	const body = JSON.parse(googleAdapter.chat!.buildRequest(req, ctx).body!);
	assert.deepEqual(body.safetySettings, [
		{ category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
		{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
		{ category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
		{ category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
		{ category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "OFF" },
	]);
});

test("google.buildRequest: omitted effort on reasoner uses lowest level + includeThoughts", () => {
	// Without reasoning in the request: the model reasons at the minimum by default and we request thoughts.
	const r = googleAdapter.chat!.buildRequest(req, geminiLevelCtx);
	const body = JSON.parse(r.body!);
	assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "minimal"); // minimum of ["minimal",...]
	assert.equal(body.generationConfig.thinkingConfig.includeThoughts, true);
});

test("google.buildRequest: Gemini 2.5 uses thinkingBudget and none disables when possible", () => {
	const r = googleAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "none" } },
		geminiBudgetCtx,
	);
	const body = JSON.parse(r.body!);
	assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, 0);
});

test("google.buildRequest: summary none does not request includeThoughts", () => {
	const r = googleAdapter.chat!.buildRequest(
		{ ...req, reasoning: { effort: "high", summary: "none" } },
		geminiLevelCtx,
	);
	const body = JSON.parse(r.body!);
	assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "high");
	assert.equal(body.generationConfig.thinkingConfig.includeThoughts, undefined);
});

test("google.buildRequest: extraBody does not overwrite managed fields", () => {
	assert.throws(
		() =>
			googleAdapter.chat!.buildRequest(
				{ ...req, extraBody: { generationConfig: {} } },
				geminiLevelCtx,
			),
		/extra_body.generationConfig/,
	);
});

test("google.parseResponse: maps candidates/usageMetadata to canonical", () => {
	const raw = {
		candidates: [
			{
				content: { role: "model", parts: [{ text: "hello!" }] },
				finishReason: "STOP",
				index: 0,
			},
		],
		usageMetadata: {
			promptTokenCount: 5,
			candidatesTokenCount: 2,
			totalTokenCount: 7,
		},
		modelVersion: "gemini-2.5-flash",
	};
	const u = googleAdapter.chat!.parseResponse(raw, ctx);
	assert.equal(u.choices[0]!.message.content, "hello!");
	assert.equal(u.choices[0]!.finishReason, "stop");
	assert.equal(u.usage.totalTokens, 7);
	assert.equal(u.usage.promptTokens, 5);
});

test("google.parseResponse: documented and future finish reasons remain observable", () => {
	const parse = (finishReason: string) =>
		googleAdapter.chat!.parseResponse(
			{
				candidates: [
					{ content: { parts: [{ text: "partial" }] }, finishReason },
				],
				usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
			},
			ctx,
		);
	const other = parse("OTHER");
	assert.equal(other.choices[0]?.finishReason, "stop");
	assert.equal(adapterDiagnostics(other)?.originalTerminalReason, "OTHER");
	assert.equal(parse("LANGUAGE").choices[0]?.finishReason, "content_filter");
	assert.equal(parse("FUTURE_REASON").choices[0]?.finishReason, "stop");
});

test("google.parseResponse: functionCall -> tool_calls + finish tool_calls", () => {
	const raw = {
		candidates: [
			{
				content: {
					role: "model",
					parts: [
						{
							thoughtSignature: "thought-signature-a",
							functionCall: {
								id: "function-call-1",
								name: "get_weather",
								args: { city: "Caracas" },
							},
						},
					],
				},
				finishReason: "STOP",
				index: 0,
			},
		],
		usageMetadata: {
			promptTokenCount: 3,
			candidatesTokenCount: 4,
			totalTokenCount: 7,
		},
	};
	const u = googleAdapter.chat!.parseResponse(raw, ctx);
	assert.equal(u.choices[0]!.finishReason, "tool_calls");
	assert.equal(u.choices[0]!.message.toolCalls?.[0]?.id, "function-call-1");
	assert.equal(u.choices[0]!.message.toolCalls?.[0]?.name, "get_weather");
	assert.equal(
		u.choices[0]!.message.toolCalls?.[0]?.arguments,
		'{"city":"Caracas"}',
	);
	assert.deepEqual(u.choices[0]!.message.toolCalls?.[0]?.extraContent, {
		google: { thought_signature: "thought-signature-a" },
	});
});

test("google.usage: reasoning (thoughts) is added to completion; total matches", () => {
	const raw = {
		candidates: [
			{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP", index: 0 },
		],
		usageMetadata: {
			promptTokenCount: 6,
			candidatesTokenCount: 1,
			thoughtsTokenCount: 68,
			totalTokenCount: 75,
		},
	};
	const u = googleAdapter.chat!.parseResponse(raw, ctx).usage;
	assert.equal(u.completionTokens, 69); // 1 visible + 68 thoughts
	assert.equal(u.reasoningTokens, 68);
	assert.equal(u.totalTokens, 75);
	assert.ok(isUsageConsistent(u), "total must be prompt + completion");
});

test("google.parseResponse: thought parts do NOT leak into content", () => {
	const raw = {
		candidates: [
			{
				content: {
					role: "model",
					parts: [
						{ text: "thinking out loud...", thought: true },
						{ text: "final answer" },
					],
				},
				finishReason: "STOP",
				index: 0,
			},
		],
		usageMetadata: {
			promptTokenCount: 5,
			candidatesTokenCount: 2,
			thoughtsTokenCount: 10,
			totalTokenCount: 17,
		},
	};
	const u = googleAdapter.chat!.parseResponse(raw, ctx);
	assert.equal(u.choices[0]!.message.content, "final answer");
	assert.equal(u.choices[0]!.message.reasoning, "thinking out loud...");
});

test("google.parseResponse: promptFeedback block is a content-filter terminal", () => {
	const response = googleAdapter.chat!.parseResponse(
		{
			promptFeedback: { blockReason: "SAFETY" },
			usageMetadata: { promptTokenCount: 3, totalTokenCount: 3 },
		},
		ctx,
	);
	assert.equal(response.choices.length, 1);
	assert.equal(response.choices[0]!.finishReason, "content_filter");
	assert.equal(response.choices[0]!.message.content, null);
});

test("google.parseResponse: empty 2xx without terminal evidence is invalid", () => {
	assert.throws(
		() => googleAdapter.chat!.parseResponse({ candidates: [] }, ctx),
		(error: unknown) =>
			GatewayError.is(error) && error.code === "upstream_protocol_error",
	);
});

test("google.parseStream: thought parts emit reasoning, not content", async () => {
	const sse =
		`data: {"candidates":[{"content":{"parts":[{"text":"hmm","thought":true}],"role":"model"},"index":0}]}\n\n` +
		`data: {"candidates":[{"content":{"parts":[{"text":"hello"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":1,"totalTokenCount":2}}\n\n`;
	const out: string[] = [];
	const reasoning: string[] = [];
	for await (const c of googleAdapter.chat!.parseStream(
		new Response(sse).body!,
		ctx,
	)) {
		if (c.choices[0]?.delta.content) out.push(c.choices[0].delta.content);
		if (c.choices[0]?.delta.reasoning)
			reasoning.push(c.choices[0].delta.reasoning);
	}
	assert.equal(out.join(""), "hello"); // "hmm" (thought) excluded
	assert.equal(reasoning.join(""), "hmm");
});

test("google.mapError: context overflow 400 -> context_window (without dedicated code)", () => {
	const err = {
		status: 400,
		body: {
			error: {
				status: "INVALID_ARGUMENT",
				message:
					"The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).",
			},
		},
	};
	const ge = googleAdapter.chat!.mapError(err, ctx);
	assert.equal(ge.class, "context_window");
});

test("google.mapError: generic 400 stays bad_request", () => {
	const err = {
		status: 400,
		body: { error: { message: "Invalid value for 'temperature'." } },
	};
	const ge = googleAdapter.chat!.mapError(err, ctx);
	assert.equal(ge.class, "bad_request");
});

test("google.mapError: google.rpc.RetryInfo controls capacity cooldown", () => {
	const ge = googleAdapter.chat!.mapError(
		{
			status: 429,
			body: {
				error: {
					message: "Quota exceeded",
					details: [
						{
							"@type": "type.googleapis.com/google.rpc.RetryInfo",
							retryDelay: "6.125s",
						},
					],
				},
			},
		},
		ctx,
	);
	assert.equal(ge.class, "rate_limit");
	assert.equal(ge.failureKind, "throttle");
	assert.equal(ge.retryAfterMs, 6125);
});

test("google.parseStream: deltas + usage final", async () => {
	const sse =
		`data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"},"index":0}]}\n\n` +
		`data: {"candidates":[{"content":{"parts":[{"text":"lo"}]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2,"totalTokenCount":5}}\n\n`;
	const stream = new Response(sse).body!;
	const out: string[] = [];
	let usageTotal: number | undefined;
	let firstHadRole = false;
	let i = 0;
	for await (const chunk of googleAdapter.chat!.parseStream(stream, ctx)) {
		if (i === 0 && chunk.choices[0]?.delta.role === "assistant")
			firstHadRole = true;
		if (chunk.choices[0]?.delta.content)
			out.push(chunk.choices[0].delta.content);
		if (chunk.usage) usageTotal = chunk.usage.totalTokens;
		i++;
	}
	assert.equal(out.join(""), "Hello");
	assert.equal(firstHadRole, true);
	assert.equal(usageTotal, 5);
});

test("google.parseStream: tool call indexes remain contiguous across events", async () => {
	const sse =
		`data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"call-1","name":"first","args":{}}}],"role":"model"},"index":0}]}\n\n` +
		`data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"call-2","name":"second","args":{}}}]},"finishReason":"STOP","index":0}]}\n\n`;
	const indexes: number[] = [];
	for await (const chunk of googleAdapter.chat!.parseStream(
		new Response(sse).body!,
		ctx,
	)) {
		for (const toolCall of chunk.choices[0]?.delta.toolCalls ?? [])
			indexes.push(toolCall.index);
	}

	assert.deepEqual(indexes, [0, 1]);
});

test("google.parseStream: repeated STOP after a tool call remains one tool terminal", async () => {
	const sse =
		`data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"call-1","name":"search_web","args":{"queries":["example"]}}}],"role":"model"},"finishReason":"STOP","index":0}]}` +
		"\n\n" +
		`data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2,"totalTokenCount":12}}` +
		"\n\n";
	const observed = observeChatStream(
		googleAdapter.chat!.parseStream(new Response(sse).body!, ctx),
	);
	const chunks = [];
	for await (const chunk of observed.items) chunks.push(chunk);

	assert.deepEqual(
		chunks.map((chunk) => chunk.choices[0]?.finishReason),
		[null, null, "tool_calls"],
	);
	assert.deepEqual(observed.observation.terminal, {
		outcome: "completed",
		reason: "tool_calls",
		usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
	});
});

test("google.parseStream: finish evidence before a trailing tool call closes once", async () => {
	const sse =
		`data: {"candidates":[{"content":{"parts":[{"text":"thinking","thought":true}],"role":"model"},"finishReason":"STOP","index":0}]}` +
		"\n\n" +
		`data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"call-1","name":"search_web","args":{"queries":["example"]}}}],"role":"model"},"index":0}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2,"totalTokenCount":12}}` +
		"\n\n";
	const observed = observeChatStream(
		googleAdapter.chat!.parseStream(new Response(sse).body!, ctx),
	);
	const chunks = [];
	for await (const chunk of observed.items) chunks.push(chunk);

	assert.deepEqual(
		chunks.map((chunk) => chunk.choices[0]?.finishReason),
		[null, null, "tool_calls"],
	);
	assert.deepEqual(observed.observation.terminal, {
		outcome: "completed",
		reason: "tool_calls",
		usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
	});
});

test("google.parseResponse: documented safety reasons stay blocked even with tool parts", () => {
	for (const finishReason of ["SPII", "IMAGE_SAFETY"] as const) {
		const response = googleAdapter.chat!.parseResponse(
			{
				candidates: [
					{
						index: 0,
						finishReason,
						content: {
							parts: [{ functionCall: { name: "search_web", args: {} } }],
						},
					},
				],
				usageMetadata: {},
			},
			ctx,
		);
		assert.equal(response.choices[0]?.finishReason, "content_filter");
	}
});

test("google.parseResponse: malformed and unexpected tool calls are explicit upstream failures", () => {
	for (const finishReason of [
		"MALFORMED_FUNCTION_CALL",
		"UNEXPECTED_TOOL_CALL",
	] as const) {
		assert.throws(
			() =>
				googleAdapter.chat!.parseResponse(
					{
						candidates: [{ index: 0, finishReason, content: { parts: [] } }],
					},
					ctx,
				),
			(error: unknown) =>
				GatewayError.is(error) &&
				error.code === "upstream_invalid_tool_call" &&
				error.deploymentHealth === "neutral",
		);
	}
});

test("google.buildRequest: a client-echoed suffixed id arrives clean via the contract", async () => {
	// End to end through the chat contract: the client echoes the suffixed id verbatim; the
	// adapter must see a clean functionCall.id with the signature reattached.
	const { toCanonicalChatRequest, chatRequestSchema } = await import(
		"#contracts/openai/chat.ts"
	);
	const canonical = toCanonicalChatRequest(
		chatRequestSchema.parse({
			model: "gemini",
			messages: [
				{ role: "user", content: "hi" },
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{
							id: "call_1__thought__sig-a",
							type: "function",
							function: { name: "f", arguments: "{}" },
						},
					],
				},
				{ role: "tool", tool_call_id: "call_1__thought__sig-a", content: "ok" },
			],
		}),
	);
	const r = googleAdapter.chat!.buildRequest(canonical, ctx);
	const body = JSON.parse(r.body!);
	const fnCallPart = body.contents[1].parts[0];
	const fnCall = fnCallPart.functionCall;
	assert.equal(fnCall.id, "call_1");
	assert.equal(fnCallPart.thoughtSignature, "sig-a");
	assert.equal(fnCall.thoughtSignature, undefined);
	// The tool result maps back to the function name via the clean id.
	assert.equal(body.contents[2].parts[0].functionResponse.name, "f");
});

test("google.buildRequest: sampling controls match the catalog surface", () => {
	const built = googleAdapter.chat!.buildRequest(
		{
			...req,
			seed: 42,
			topK: 32,
			presencePenalty: 0.2,
			frequencyPenalty: 0.3,
			n: 2,
		},
		ctx,
	);
	assert.deepEqual(JSON.parse(built.body!).generationConfig, {
		temperature: 0.4,
		topK: 32,
		maxOutputTokens: 50,
		candidateCount: 2,
		presencePenalty: 0.2,
		frequencyPenalty: 0.3,
		seed: 42,
	});
});

test("google.parseStream: every candidate is preserved", async () => {
	const sse = `data: {"candidates":[{"content":{"parts":[{"text":"A"}]},"finishReason":"STOP","index":0},{"content":{"parts":[{"text":"B"}]},"finishReason":"STOP","index":1}]}\n\n`;
	const chunks = [];
	for await (const chunk of googleAdapter.chat!.parseStream(
		new Response(sse).body!,
		ctx,
	))
		chunks.push(chunk);
	assert.deepEqual(
		chunks[0]?.choices.map((choice) => ({
			index: choice.index,
			content: choice.delta.content,
		})),
		[
			{ index: 0, content: "A" },
			{ index: 1, content: "B" },
		],
	);
});

test("google content signatures: complete native parts survive replay", () => {
	const parsed = googleAdapter.chat!.parseResponse(
		{
			modelVersion: "gemini",
			candidates: [
				{
					index: 0,
					finishReason: "STOP",
					content: {
						parts: [
							{
								text: "internal",
								thought: true,
								thoughtSignature: "sig-text",
							},
							{ text: "answer" },
						],
					},
				},
			],
			usageMetadata: {},
		},
		ctx,
	);
	const message = parsed.choices[0]!.message;
	const replay = googleAdapter.chat!.buildRequest(
		{
			...req,
			messages: [
				{
					role: "assistant",
					content: message.content,
					providerFields: message.providerFields!,
				},
			],
		},
		ctx,
	);
	assert.deepEqual(JSON.parse(replay.body!).contents[0].parts, [
		{
			text: "internal",
			thought: true,
			thoughtSignature: "sig-text",
		},
		{ text: "answer" },
	]);
});
