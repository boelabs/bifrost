import type {
	CanonicalRealtimeConversationConfig,
	CanonicalRealtimeConversationEvent,
} from "#core/realtime.ts";
import { realtimeConversationProfileFor } from "#catalog/types.ts";
import { resolveModelMetadata } from "#catalog/index.ts";
import { type WebSocket, WebSocketServer } from "ws";
import type { AdapterContext } from "../types.ts";
import type { AddressInfo } from "node:net";
import { googleAdapter } from "./index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	parseGeminiConversationMessage,
	ConversationHistory,
	pcmLevel,
	geminiConversationSetup,
	geminiFunctionResponse,
	geminiClientContent,
} from "./liveConversation.ts";

const MODEL = "gemini-3.8-live";

function config(
	overrides: Partial<CanonicalRealtimeConversationConfig> = {},
): CanonicalRealtimeConversationConfig {
	return {
		model: "public",
		outputModality: "audio",
		vad: {
			type: "server_vad",
			interruptResponse: true,
			createResponse: true,
		},
		inputTranscription: null,
		tools: [],
		toolChoice: "auto",
		googleSearch: false,
		truncation: "auto",
		...overrides,
	};
}

const profile = () =>
	realtimeConversationProfileFor(resolveModelMetadata("googleaistudio", MODEL));

test("gemini live conversation: the adapter serves realtime conversations for the Live models", () => {
	assert.ok(googleAdapter.supportedCallTypes.has("realtime.conversation"));
	assert.ok(googleAdapter.realtimeConversation);
	for (const model of [
		"gemini-3.8-live",
		"gemini-3.8-live-extended-thinking",
		"gemini-3.1-flash-live-preview",
		"gemini-2.5-flash-native-audio-preview-12-2025",
		"gemini-3.5-live-translate-preview",
	]) {
		const meta = resolveModelMetadata("googleaistudio", model);
		assert.ok(
			meta.supportedCallTypes?.includes("realtime.conversation"),
			model,
		);
		assert.ok(!meta.supportedCallTypes?.includes("chat"), model);
	}
});

test("gemini live conversation: setup maps instructions, voice, VAD, tools, transcription and resumption", () => {
	const setup = geminiConversationSetup(
		config({
			instructions: "Be brief.",
			voice: "Kore",
			vad: {
				type: "server_vad",
				threshold: 0.7,
				prefixPaddingMs: 200,
				silenceDurationMs: 600,
				interruptResponse: false,
				createResponse: true,
			},
			inputTranscription: { languages: ["es-419"], keywords: ["Bifrozz"] },
			tools: [
				{
					name: "lookup",
					description: "Finds an order",
					parameters: {
						type: "object",
						properties: { id: { type: "string" } },
					},
				},
			],
			googleSearch: true,
			maxOutputTokens: 512,
		}),
		MODEL,
		profile(),
		"handle-1",
	).setup as Record<string, any>;
	assert.equal(setup.model, `models/${MODEL}`);
	assert.deepEqual(setup.generationConfig, {
		responseModalities: ["AUDIO"],
		speechConfig: {
			voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
		},
		maxOutputTokens: 512,
	});
	assert.deepEqual(setup.systemInstruction, { parts: [{ text: "Be brief." }] });
	assert.deepEqual(setup.tools, [
		{
			functionDeclarations: [
				{
					name: "lookup",
					description: "Finds an order",
					parametersJsonSchema: {
						type: "object",
						properties: { id: { type: "string" } },
					},
					behavior: "BLOCKING",
				},
			],
		},
		{ googleSearch: {} },
	]);
	assert.deepEqual(setup.realtimeInputConfig, {
		automaticActivityDetection: {
			startOfSpeechSensitivity: "START_SENSITIVITY_LOW",
			prefixPaddingMs: 200,
			silenceDurationMs: 600,
		},
		activityHandling: "NO_INTERRUPTION",
	});
	assert.deepEqual(setup.inputAudioTranscription, {
		languageCodes: ["es-419"],
		customVocabulary: ["Bifrozz"],
	});
	assert.deepEqual(setup.outputAudioTranscription, {});
	assert.deepEqual(setup.sessionResumption, { handle: "handle-1" });
	assert.deepEqual(setup.contextWindowCompression, { slidingWindow: {} });
});

test("gemini live conversation: manual turns, text sessions, reasoning and translation", () => {
	const manual = geminiConversationSetup(
		config({
			vad: null,
			outputModality: "text",
			toolChoice: "none",
			tools: [{ name: "x" }],
			truncation: "disabled",
		}),
		MODEL,
		profile(),
		null,
	).setup as Record<string, any>;
	assert.deepEqual(manual.realtimeInputConfig, {
		automaticActivityDetection: { disabled: true },
	});
	// An audio-only model answers a text session in audio; the transcript carries the text.
	assert.deepEqual(manual.generationConfig.responseModalities, ["AUDIO"]);
	assert.deepEqual(manual.outputAudioTranscription, {});
	assert.equal(manual.tools, undefined);
	assert.deepEqual(manual.sessionResumption, {});
	assert.equal(manual.contextWindowCompression, undefined);

	const thinking = geminiConversationSetup(
		config({ reasoningEffort: "high", tools: [{ name: "x" }] }),
		"gemini-3.8-live-extended-thinking",
		realtimeConversationProfileFor(
			resolveModelMetadata(
				"googleaistudio",
				"gemini-3.8-live-extended-thinking",
			),
		),
		null,
	).setup as Record<string, any>;
	assert.deepEqual(thinking.generationConfig.thinkingConfig, {
		thinkingLevel: "HIGH",
	});
	assert.equal(
		thinking.tools[0].functionDeclarations[0].behavior,
		"NON_BLOCKING",
	);

	const translate = geminiConversationSetup(
		config({
			translation: { targetLanguage: "es", echoTargetLanguage: false },
		}),
		"gemini-3.5-live-translate-preview",
		realtimeConversationProfileFor(
			resolveModelMetadata(
				"googleaistudio",
				"gemini-3.5-live-translate-preview",
			),
		),
		"ignored",
	).setup as Record<string, any>;
	assert.deepEqual(translate.generationConfig.translationConfig, {
		targetLanguageCode: "es",
		echoTargetLanguage: false,
	});
	// The translation model has no session resumption.
	assert.equal(translate.sessionResumption, undefined);

	const semantic = geminiConversationSetup(
		config({
			vad: {
				type: "semantic_vad",
				eagerness: "high",
				interruptResponse: true,
				createResponse: true,
			},
		}),
		MODEL,
		profile(),
		null,
	).setup as Record<string, any>;
	assert.deepEqual(semantic.realtimeInputConfig, {
		automaticActivityDetection: {
			endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
		},
	});
});

test("gemini live conversation: server messages map to canonical events", () => {
	const audio = Buffer.from([1, 0, 2, 0]).toString("base64");
	const parsed = parseGeminiConversationMessage(
		{
			serverContent: {
				modelTurn: {
					parts: [
						{ thought: true, text: "thinking" },
						{ inlineData: { mimeType: "audio/pcm;rate=24000", data: audio } },
						{ text: "not a transcript" },
					],
				},
				outputTranscription: { text: "Hola" },
				inputTranscription: { text: "Buenos" },
				turnComplete: true,
			},
			usageMetadata: {
				promptTokenCount: 120,
				responseTokenCount: 60,
				promptTokensDetails: [
					{ modality: "AUDIO", tokenCount: 100 },
					{ modality: "TEXT", tokenCount: 20 },
				],
				responseTokensDetails: [
					{ modality: "AUDIO", tokenCount: 50 },
					{ modality: "TEXT", tokenCount: 10 },
				],
			},
		},
		{ nativeText: false },
	);
	assert.deepEqual(parsed.events, [
		{ kind: "input_transcript", text: "Buenos" },
		{ kind: "output_audio", pcm: Buffer.from([1, 0, 2, 0]) },
		{ kind: "output_transcript", text: "Hola" },
		{
			kind: "usage",
			usage: {
				inputTokens: 120,
				outputTokens: 60,
				totalTokens: 180,
				audioTokens: 100,
				textTokens: 20,
				outputAudioTokens: 50,
				outputTextTokens: 10,
			},
		},
		{ kind: "turn_complete" },
	]);
	assert.equal(parsed.modelBusy, false);

	const calls = parseGeminiConversationMessage(
		{
			toolCall: {
				functionCalls: [{ id: "fc_1", name: "lookup", args: { id: "7" } }],
			},
		},
		{ nativeText: false },
	);
	assert.deepEqual(calls.events, [
		{
			kind: "function_calls",
			calls: [{ id: "fc_1", name: "lookup", arguments: '{"id":"7"}' }],
		},
	]);
	assert.equal(calls.modelBusy, true);

	const control = parseGeminiConversationMessage(
		{
			voiceActivity: { type: "ACTIVITY_START", audioOffset: "1.2s" },
			sessionResumptionUpdate: { newHandle: "h2", resumable: true },
			goAway: { timeLeft: "12s" },
		},
		{ nativeText: false },
	);
	assert.deepEqual(control.events, [{ kind: "speech_started" }]);
	assert.equal(control.userSpeaking, true);
	assert.deepEqual(control.resumption, { handle: "h2", resumable: true });
	assert.equal(control.goAwayMs, 12_000);

	assert.deepEqual(
		parseGeminiConversationMessage(
			{
				serverContent: { interrupted: true },
				toolCallCancellation: { ids: ["fc_1"] },
			},
			{ nativeText: false },
		).events,
		[
			{ kind: "interrupted" },
			{ kind: "function_calls_cancelled", ids: ["fc_1"] },
		],
	);
});

test("gemini live conversation: function outputs and client turns", () => {
	assert.deepEqual(
		geminiFunctionResponse({
			id: "fc_1",
			name: "lookup",
			output: '{"status":"shipped"}',
		}),
		{ id: "fc_1", name: "lookup", response: { status: "shipped" } },
	);
	assert.deepEqual(
		geminiFunctionResponse({ id: "fc_1", name: "lookup", output: "shipped" }),
		{ id: "fc_1", name: "lookup", response: { output: "shipped" } },
	);
	assert.deepEqual(
		geminiClientContent(
			[
				{
					role: "user",
					parts: [
						{ type: "text", text: "Mira esto" },
						{ type: "image", mimeType: "image/png", data: "iVBO" },
					],
				},
			],
			true,
		),
		{
			clientContent: {
				turns: [
					{
						role: "user",
						parts: [
							{ text: "Mira esto" },
							{ inlineData: { mimeType: "image/png", data: "iVBO" } },
						],
					},
				],
				turnComplete: true,
			},
		},
	);
});

/* ------------------------------------------------------------------ against a live stub */

interface StubConnection {
	socket: WebSocket;
	messages: Record<string, any>[];
}

async function withStub(
	run: (baseUrl: string, connections: StubConnection[]) => Promise<void>,
): Promise<void> {
	const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const connections: StubConnection[] = [];
	server.on("connection", (socket) => {
		const connection: StubConnection = { socket, messages: [] };
		connections.push(connection);
		socket.on("message", (data) => {
			const message = JSON.parse(data.toString()) as Record<string, any>;
			connection.messages.push(message);
			if (message.setup) {
				socket.send(JSON.stringify({ setupComplete: {} }));
			}
		});
	});
	const { port } = server.address() as AddressInfo;
	try {
		await run(`http://127.0.0.1:${port}/v1beta`, connections);
	} finally {
		for (const client of server.clients) {
			client.terminate();
		}
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}

function ctx(baseUrl: string): AdapterContext {
	return {
		upstreamModel: MODEL,
		credentials: { apiKey: "AIza-test", baseUrl },
		meta: resolveModelMetadata("googleaistudio", MODEL),
		transport: "bidi_generate_content",
		requestId: "t",
	};
}

async function until(condition: () => boolean, label: string): Promise<void> {
	const deadline = Date.now() + 2000;
	while (!condition()) {
		if (Date.now() > deadline) {
			throw new Error(`timed out waiting for ${label}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

test("gemini live conversation: a new configuration opens a new session seeded with the conversation; goAway resumes", async () => {
	await withStub(async (baseUrl, connections) => {
		const handler = googleAdapter.realtimeConversation;
		assert.ok(handler);
		const session = await handler.connect(config(), ctx(baseUrl));
		const events: CanonicalRealtimeConversationEvent[] = [];
		const reading = (async () => {
			for await (const event of session.events) {
				events.push(event);
			}
		})();
		const [first] = connections;
		assert.ok(first);
		first.socket.send(
			JSON.stringify({
				sessionResumptionUpdate: { newHandle: "h1", resumable: true },
			}),
		);
		session.sendTurns(
			[{ role: "user", parts: [{ type: "text", text: "Me llamo Ana." }] }],
			true,
		);
		// The model is speaking: the switch waits for its turn to end.
		first.socket.send(
			JSON.stringify({
				serverContent: {
					modelTurn: {
						parts: [
							{
								inlineData: { mimeType: "audio/pcm;rate=24000", data: "AAAA" },
							},
						],
					},
					outputTranscription: { text: "Hola, Ana." },
				},
				sessionResumptionUpdate: { newHandle: "h2", resumable: false },
			}),
		);
		await until(() => events.length === 2, "model audio");
		const switched = session.reconfigure(
			config({ instructions: "Now in Spanish." }),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(connections.length, 1);
		first.socket.send(
			JSON.stringify({
				serverContent: { turnComplete: true },
				sessionResumptionUpdate: { newHandle: "h3", resumable: true },
			}),
		);
		await switched;
		const [, second] = connections;
		assert.ok(second);
		// A resumed session would keep its old setup: this is a new one, seeded with the conversation.
		assert.deepEqual(second.messages[0]?.setup.sessionResumption, {});
		assert.deepEqual(second.messages[0]?.setup.historyConfig, {
			initialHistoryInClientContent: true,
		});
		assert.deepEqual(second.messages[0]?.setup.systemInstruction, {
			parts: [{ text: "Now in Spanish." }],
		});
		await until(() => second.messages.length === 2, "history seed");
		assert.deepEqual(second.messages[1]?.clientContent, {
			turns: [
				{ role: "user", parts: [{ text: "Me llamo Ana." }] },
				{ role: "model", parts: [{ text: "Hola, Ana." }] },
			],
			turnComplete: true,
		});
		// Input after the switch goes to the new connection only.
		session.sendTurns(
			[{ role: "user", parts: [{ type: "text", text: "hola" }] }],
			true,
		);
		await until(() => second.messages.length === 3, "client content");
		assert.equal(second.messages[2]?.clientContent.turnComplete, true);
		assert.equal(
			first.messages.filter((message) => message.clientContent).length,
			1,
		);
		// goAway rotates with the latest handle and the same configuration.
		second.socket.send(
			JSON.stringify({
				sessionResumptionUpdate: { newHandle: "h4", resumable: true },
			}),
		);
		second.socket.send(JSON.stringify({ goAway: { timeLeft: "20s" } }));
		await until(() => connections.length === 3, "third connection");
		assert.deepEqual(connections[2]?.messages[0]?.setup.sessionResumption, {
			handle: "h4",
		});
		session.close();
		await reading;
	});
});

test("gemini live conversation: the recorded history flattens function calls for models without historyConfig", () => {
	const history = new ConversationHistory();
	history.event({ kind: "input_transcript", text: "Mi pedido 7?" });
	history.event({
		kind: "function_calls",
		calls: [{ id: "fc_1", name: "order_status", arguments: '{"id":"7"}' }],
	});
	history.functionResults([
		{ id: "fc_1", name: "order_status", output: '{"status":"sent"}' },
	]);
	history.event({ kind: "output_transcript", text: "Ya salio." });
	history.event({ kind: "turn_complete" });
	assert.deepEqual(history.contents(true), [
		{ role: "user", parts: [{ text: "Mi pedido 7?" }] },
		{
			role: "model",
			parts: [
				{
					functionCall: { id: "fc_1", name: "order_status", args: { id: "7" } },
				},
			],
		},
		{
			role: "user",
			parts: [
				{
					functionResponse: {
						id: "fc_1",
						name: "order_status",
						response: { status: "sent" },
					},
				},
			],
		},
		{ role: "model", parts: [{ text: "Ya salio." }] },
	]);
	assert.deepEqual(history.contents(false)[1], {
		role: "model",
		parts: [{ text: '[called order_status({"id":"7"})]' }],
	});
	assert.deepEqual(history.contents(false)[2], {
		role: "user",
		parts: [{ text: '[order_status returned {"status":"sent"}]' }],
	});
	assert.ok(pcmLevel(Buffer.alloc(480)) < 1);
});
