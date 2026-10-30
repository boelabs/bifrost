import type { CanonicalRealtimeTranscriptionEvent } from "#core/realtime.ts";
import { resolveModelMetadata } from "#catalog/index.ts";
import { type WebSocket, WebSocketServer } from "ws";
import type { AdapterContext } from "../types.ts";
import { GatewayError } from "#core/errors.ts";
import type { AddressInfo } from "node:net";
import { googleAdapter } from "./index.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	parseGeminiLiveMessage,
	geminiLiveSetup,
	geminiLiveUsage,
	geminiLiveUrl,
	closeStatus,
} from "./live.ts";

const MODEL = "gemini-3.5-transcribe-live";

test("gemini live: the adapter serves realtime transcription over BidiGenerateContent", () => {
	assert.ok(googleAdapter.supportedCallTypes.has("realtime.transcription"));
	assert.ok(googleAdapter.realtimeTranscription);
	assert.deepEqual(googleAdapter.transports?.["realtime.transcription"], {
		supported: ["bidi_generate_content"],
		default: "bidi_generate_content",
	});
	const meta = resolveModelMetadata("googleaistudio", MODEL);
	assert.ok(meta.supportedCallTypes?.includes("realtime.transcription"));
	assert.ok(!meta.supportedCallTypes?.includes("audio.transcriptions"));
});

test("gemini live: the WebSocket URL follows the credential's host and API version", () => {
	assert.equal(
		geminiLiveUrl(undefined),
		"wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent",
	);
	assert.equal(
		geminiLiveUrl("http://127.0.0.1:9000/v1alpha/"),
		"ws://127.0.0.1:9000/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent",
	);
});

test("gemini live: setup carries vocabulary, languages, smart mode and manual turns", () => {
	assert.deepEqual(
		geminiLiveSetup(
			{
				model: "public",
				turnDetection: "manual",
				languages: ["es-419", "en-US"],
				keywords: ["Bifrost"],
				mode: "smart",
			},
			MODEL,
			{ supportsKeywords: true },
		),
		{
			setup: {
				model: `models/${MODEL}`,
				generationConfig: { responseModalities: ["TEXT"] },
				inputAudioTranscription: {
					languageCodes: ["es-419", "en-US"],
					customVocabulary: ["Bifrost"],
					mode: "SMART",
				},
				realtimeInputConfig: {
					automaticActivityDetection: { disabled: true },
				},
			},
		},
	);
	const plain = geminiLiveSetup(
		{ model: "public", turnDetection: "server_vad", keywords: ["x"] },
		MODEL,
		{ supportsKeywords: false },
	).setup as Record<string, unknown>;
	assert.deepEqual(plain.inputAudioTranscription, {});
	assert.equal(plain.realtimeInputConfig, undefined);
});

test("gemini live: server messages map to interim, final, usage and goAway", () => {
	assert.deepEqual(
		parseGeminiLiveMessage({
			serverContent: {
				interimInputTranscription: { text: "hola" },
				inputTranscription: { text: "Hola." },
			},
			usageMetadata: {
				promptTokenCount: 50,
				responseTokenCount: 4,
				totalTokenCount: 54,
				promptTokensDetails: [{ modality: "AUDIO", tokenCount: 50 }],
			},
			goAway: { timeLeft: "5s" },
		}),
		{
			setupComplete: false,
			interim: "hola",
			final: "Hola.",
			usage: {
				inputTokens: 50,
				outputTokens: 4,
				totalTokens: 54,
				audioTokens: 50,
			},
			goAway: true,
		},
	);
	assert.equal(
		parseGeminiLiveMessage({ setupComplete: {} }).setupComplete,
		true,
	);
	assert.equal(geminiLiveUsage({ totalTokenCount: 0 }), undefined);
});

test("gemini live: close codes map to the provider's error classes", () => {
	assert.equal(closeStatus(1008, "API key not valid"), 403);
	assert.equal(closeStatus(1011, "Resource exhausted: quota"), 429);
	assert.equal(closeStatus(1007, "Invalid argument"), 400);
	assert.equal(closeStatus(1008, "models/x is not found"), 404);
	assert.equal(closeStatus(1011, "Internal error"), 500);
	assert.equal(closeStatus(1013, ""), 503);
	assert.equal(closeStatus(1006, ""), 502);
});

/* ------------------------------------------------------------------ against a live stub */

interface StubConnection {
	socket: WebSocket;
	apiKey: string | undefined;
	messages: Record<string, any>[];
}

async function withStub(
	onSetup: (connection: StubConnection, index: number) => void,
	run: (baseUrl: string, connections: StubConnection[]) => Promise<void>,
): Promise<void> {
	const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const connections: StubConnection[] = [];
	server.on("connection", (socket, request) => {
		const connection: StubConnection = {
			socket,
			apiKey: request.headers["x-goog-api-key"] as string | undefined,
			messages: [],
		};
		const index = connections.push(connection) - 1;
		socket.on("message", (data) => {
			const message = JSON.parse(data.toString()) as Record<string, any>;
			connection.messages.push(message);
			if (message.setup) {
				onSetup(connection, index);
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

test("gemini live: a session streams audio and yields transcripts, then reconnects on goAway", async () => {
	await withStub(
		(connection) =>
			connection.socket.send(JSON.stringify({ setupComplete: {} })),
		async (baseUrl, connections) => {
			const session = await must().connect(
				{ model: "public", turnDetection: "server_vad", keywords: ["Bifrost"] },
				ctx(baseUrl),
			);
			const events: CanonicalRealtimeTranscriptionEvent[] = [];
			const reading = (async () => {
				for await (const event of session.events) {
					events.push(event);
				}
			})();

			const [first] = connections;
			assert.ok(first);
			assert.equal(first.apiKey, "AIza-test");
			assert.equal(first.messages[0]?.setup.model, `models/${MODEL}`);
			assert.deepEqual(
				first.messages[0]?.setup.inputAudioTranscription.customVocabulary,
				["Bifrost"],
			);

			// Audio is batched into 100 ms chunks.
			session.appendAudio(Buffer.alloc(1600));
			assert.equal(first.messages.length, 1);
			session.appendAudio(Buffer.alloc(1600));
			await until(() => first.messages.length === 2, "first audio chunk");
			assert.deepEqual(Object.keys(first.messages[1]?.realtimeInput), [
				"audio",
			]);
			assert.equal(
				first.messages[1]?.realtimeInput.audio.mimeType,
				"audio/pcm;rate=16000",
			);
			assert.equal(
				Buffer.from(first.messages[1]?.realtimeInput.audio.data, "base64")
					.byteLength,
				3200,
			);

			first.socket.send(
				JSON.stringify({
					serverContent: { interimInputTranscription: { text: "hola" } },
				}),
			);
			first.socket.send(
				JSON.stringify({
					serverContent: { inputTranscription: { text: "Hola mundo." } },
					usageMetadata: { promptTokenCount: 40, responseTokenCount: 3 },
				}),
			);
			await until(() => events.length === 3, "first transcripts");
			// Usage that shares a message with a final transcript comes first: it belongs to it.
			assert.deepEqual(events, [
				{ kind: "interim", text: "hola" },
				{
					kind: "usage",
					usage: { inputTokens: 40, outputTokens: 3, totalTokens: 43 },
				},
				{ kind: "final", text: "Hola mundo." },
			]);

			// goAway: a second connection takes the audio; the first is told the stream ended.
			first.socket.send(JSON.stringify({ goAway: { timeLeft: "10s" } }));
			await until(() => connections.length === 2, "second connection");
			const [, second] = connections;
			assert.ok(second);
			await until(
				() =>
					first.messages.some(
						(message) => message.realtimeInput?.audioStreamEnd === true,
					),
				"audioStreamEnd on the retired connection",
			);
			session.appendAudio(Buffer.alloc(3200));
			await until(
				() => second.messages.length === 2,
				"audio on the new connection",
			);

			// The retired connection may still deliver its last transcript.
			first.socket.send(
				JSON.stringify({
					serverContent: { inputTranscription: { text: "Late." } },
				}),
			);
			await until(() => events.length === 4, "late transcript");
			assert.deepEqual(events[3], { kind: "final", text: "Late." });

			session.close();
			await reading;
		},
	);
});

test("gemini live: manual turns send activity markers around the utterance", async () => {
	await withStub(
		(connection) =>
			connection.socket.send(JSON.stringify({ setupComplete: {} })),
		async (baseUrl, connections) => {
			const session = await must().connect(
				{ model: "public", turnDetection: "manual" },
				ctx(baseUrl),
			);
			const [stub] = connections;
			assert.ok(stub);
			assert.deepEqual(stub.messages[0]?.setup.realtimeInputConfig, {
				automaticActivityDetection: { disabled: true },
			});
			session.startUtterance();
			session.appendAudio(Buffer.alloc(100));
			session.endUtterance();
			await until(() => stub.messages.length === 4, "utterance messages");
			assert.deepEqual(stub.messages[1], {
				realtimeInput: { activityStart: {} },
			});
			assert.equal(
				Buffer.from(stub.messages[2]?.realtimeInput.audio.data, "base64")
					.byteLength,
				100,
			);
			assert.deepEqual(stub.messages[3], {
				realtimeInput: { activityEnd: {} },
			});
			session.close();
		},
	);
});

test("gemini live: a rejected setup fails the connect with the provider's error", async () => {
	await withStub(
		(connection) => connection.socket.close(1008, "API key not valid"),
		async (baseUrl) => {
			await assert.rejects(
				must().connect(
					{ model: "public", turnDetection: "server_vad" },
					ctx(baseUrl),
				),
				(error: unknown) => GatewayError.is(error) && error.class !== "server",
			);
		},
	);
});

test("gemini live: an unexpected close after setup fails the event stream", async () => {
	await withStub(
		(connection) => {
			connection.socket.send(JSON.stringify({ setupComplete: {} }));
			setTimeout(() => connection.socket.close(1011, "Internal error"), 20);
		},
		async (baseUrl) => {
			const session = await must().connect(
				{ model: "public", turnDetection: "server_vad" },
				ctx(baseUrl),
			);
			await assert.rejects(
				(async () => {
					for await (const _event of session.events) {
						// drain
					}
				})(),
				(error: unknown) => GatewayError.is(error),
			);
		},
	);
});

function must() {
	const handler = googleAdapter.realtimeTranscription;
	assert.ok(handler);
	return handler;
}
