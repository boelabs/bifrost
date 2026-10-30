import type {
	CanonicalRealtimeConversationConfig,
	CanonicalRealtimeConversationEvent,
} from "#core/realtime.ts";
import { resolveModelMetadata } from "#catalog/index.ts";
import { type WebSocket, WebSocketServer } from "ws";
import { openaiAdapter } from "./openai/index.ts";
import type { AdapterContext } from "./types.ts";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	parseOpenAIRealtimeEvent,
	openAIRealtimeSession,
	openAIRealtimeItems,
	openAIRealtimeUsage,
	openAIRealtimeUrl,
} from "./openaiRealtime.ts";

const MODEL = "gpt-realtime-2.1";

function config(
	overrides: Partial<CanonicalRealtimeConversationConfig> = {},
): CanonicalRealtimeConversationConfig {
	return {
		model: "public",
		outputModality: "audio",
		vad: { type: "server_vad", interruptResponse: true, createResponse: true },
		inputTranscription: null,
		tools: [],
		toolChoice: "auto",
		googleSearch: false,
		truncation: "auto",
		...overrides,
	};
}

test("openai realtime: the adapter serves realtime conversations for the gpt-realtime models", () => {
	assert.ok(openaiAdapter.supportedCallTypes.has("realtime.conversation"));
	assert.ok(openaiAdapter.realtimeConversation);
	assert.deepEqual(openaiAdapter.transports?.["realtime.conversation"], {
		supported: ["realtime"],
		default: "realtime",
	});
	for (const model of [
		"gpt-realtime-2.1",
		"gpt-realtime-2.1-mini",
		"gpt-realtime-2",
		"gpt-realtime-1.5",
	]) {
		const meta = resolveModelMetadata("openai", model);
		assert.ok(
			meta.supportedCallTypes?.includes("realtime.conversation"),
			model,
		);
	}
	assert.equal(
		openAIRealtimeUrl("https://api.openai.com/v1", MODEL),
		"wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1",
	);
});

test("openai realtime: the canonical configuration maps to a GA session.update", () => {
	assert.deepEqual(
		openAIRealtimeSession(
			config({
				instructions: "Be brief.",
				voice: "marin",
				speed: 1.2,
				vad: {
					type: "semantic_vad",
					eagerness: "high",
					interruptResponse: false,
					createResponse: false,
				},
				inputTranscription: { languages: ["es"], keywords: ["Bifrost"] },
				tools: [{ name: "lookup", parameters: { type: "object" } }],
				maxOutputTokens: 500,
				reasoningEffort: "xhigh",
			}),
		),
		{
			type: "realtime",
			instructions: "Be brief.",
			output_modalities: ["audio"],
			audio: {
				input: {
					format: { type: "audio/pcm", rate: 24_000 },
					turn_detection: {
						type: "semantic_vad",
						eagerness: "high",
						create_response: false,
						interrupt_response: false,
					},
					transcription: {
						model: "gpt-transcribe",
						language: "es",
						keywords: ["Bifrost"],
					},
				},
				output: {
					format: { type: "audio/pcm", rate: 24_000 },
					voice: "marin",
					speed: 1.2,
				},
			},
			tools: [
				{ type: "function", name: "lookup", parameters: { type: "object" } },
			],
			tool_choice: "auto",
			max_output_tokens: 500,
			reasoning: { effort: "xhigh" },
			truncation: "auto",
		},
	);
	const manual = openAIRealtimeSession(
		config({
			vad: null,
			inputTranscription: { model: "gpt-realtime-whisper" },
		}),
	) as Record<string, any>;
	assert.equal(manual.audio.input.turn_detection, null);
	assert.deepEqual(manual.audio.input.transcription, {
		model: "gpt-realtime-whisper",
	});
});

test("openai realtime: usage, items and server events map to the canonical form", () => {
	assert.deepEqual(
		openAIRealtimeUsage({
			total_tokens: 253,
			input_tokens: 132,
			output_tokens: 121,
			input_token_details: {
				text_tokens: 119,
				audio_tokens: 13,
				image_tokens: 0,
				cached_tokens: 64,
			},
			output_token_details: { text_tokens: 30, audio_tokens: 91 },
		}),
		{
			inputTokens: 132,
			outputTokens: 121,
			totalTokens: 253,
			textTokens: 119,
			audioTokens: 13,
			imageTokens: 0,
			cachedTokens: 64,
			outputTextTokens: 30,
			outputAudioTokens: 91,
		},
	);
	const [item] = openAIRealtimeItems([
		{
			role: "user",
			parts: [
				{ type: "text", text: "hola" },
				{ type: "image", mimeType: "image/png", data: "iVBO" },
				{ type: "audio", pcm: Buffer.alloc(3200) },
			],
		},
	]);
	assert.equal(item?.role, "user");
	const content = item?.content as Record<string, any>[];
	assert.deepEqual(content[0], { type: "input_text", text: "hola" });
	assert.deepEqual(content[1], {
		type: "input_image",
		image_url: "data:image/png;base64,iVBO",
	});
	// 100 ms at 16 kHz becomes about 100 ms at 24 kHz.
	assert.ok(
		Math.abs(Buffer.from(content[2]?.audio, "base64").byteLength - 4800) <= 8,
	);

	const state = {
		response: { calls: [] },
		transcripts: new Map<string, boolean>(),
	};
	const parse = (event: Record<string, unknown>) =>
		parseOpenAIRealtimeEvent(event, state);
	assert.deepEqual(parse({ type: "input_audio_buffer.speech_started" }), [
		{ kind: "speech_started" },
	]);
	// A transcript that arrived as deltas is not repeated by `completed`; one without deltas is.
	assert.deepEqual(
		parse({
			type: "conversation.item.input_audio_transcription.delta",
			item_id: "a",
			delta: "Hola",
		}),
		[{ kind: "input_transcript", text: "Hola" }],
	);
	assert.deepEqual(
		parse({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "a",
			transcript: "Hola",
		}),
		[],
	);
	assert.deepEqual(
		parse({
			type: "conversation.item.input_audio_transcription.completed",
			item_id: "b",
			transcript: "Adiós",
		}),
		[{ kind: "input_transcript", text: "Adiós" }],
	);
	// Function calls leave together with the response that made them.
	assert.deepEqual(
		parse({
			type: "response.function_call_arguments.done",
			call_id: "call_1",
			name: "lookup",
			arguments: '{"id":"7"}',
		}),
		[],
	);
	assert.deepEqual(
		parse({
			type: "response.done",
			response: {
				status: "completed",
				usage: { input_tokens: 10, output_tokens: 5 },
			},
		}),
		[
			{
				kind: "usage",
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			},
			{
				kind: "function_calls",
				calls: [{ id: "call_1", name: "lookup", arguments: '{"id":"7"}' }],
			},
			{ kind: "turn_complete" },
		],
	);
	assert.deepEqual(
		parse({
			type: "response.done",
			response: {
				status: "cancelled",
				status_details: { type: "cancelled", reason: "turn_detected" },
			},
		}),
		[{ kind: "interrupted" }, { kind: "turn_complete" }],
	);
	assert.deepEqual(
		parse({
			type: "error",
			error: { code: "invalid_value", message: "secret" },
		}),
		[{ kind: "provider_error", code: "invalid_value" }],
	);
});

/* ------------------------------------------------------------------ against a stub */

test("openai realtime: a session configures itself, streams 24 kHz audio, and updates live", async () => {
	const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const received: Record<string, any>[] = [];
	let upstream: WebSocket | undefined;
	let path = "";
	let authorization: string | undefined;
	server.on("connection", (socket, request) => {
		upstream = socket;
		path = request.url ?? "";
		({ authorization } = request.headers);
		socket.send(JSON.stringify({ type: "session.created", session: {} }));
		socket.on("message", (data) => {
			const event = JSON.parse(data.toString()) as Record<string, any>;
			received.push(event);
			if (event.type === "session.update") {
				socket.send(
					JSON.stringify({ type: "session.updated", session: event.session }),
				);
			}
		});
	});
	const { port } = server.address() as AddressInfo;
	const ctx: AdapterContext = {
		upstreamModel: MODEL,
		credentials: { apiKey: "sk-test", baseUrl: `http://127.0.0.1:${port}/v1` },
		meta: resolveModelMetadata("openai", MODEL),
		transport: "realtime",
		requestId: "t",
	};
	try {
		const handler = openaiAdapter.realtimeConversation;
		assert.ok(handler);
		const session = await handler.connect(config({ vad: null }), ctx);
		assert.equal(path, `/v1/realtime?model=${MODEL}`);
		assert.equal(authorization, "Bearer sk-test");
		assert.equal(received[0]?.type, "session.update");
		const events: CanonicalRealtimeConversationEvent[] = [];
		const reading = (async () => {
			for await (const event of session.events) {
				events.push(event);
			}
		})();

		// A manual turn: 100 ms at 16 kHz goes up as 24 kHz, then commit + response.create.
		session.startActivity();
		session.appendAudio(Buffer.alloc(3200));
		session.endActivity();
		const types = () => received.map((event) => event.type);
		const deadline = Date.now() + 2000;
		while (!types().includes("response.create") && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.deepEqual(types().slice(1), [
			"input_audio_buffer.append",
			"input_audio_buffer.commit",
			"response.create",
		]);

		upstream?.send(
			JSON.stringify({
				type: "response.output_audio.delta",
				delta: Buffer.alloc(480).toString("base64"),
			}),
		);
		upstream?.send(
			JSON.stringify({
				type: "response.done",
				response: {
					status: "completed",
					usage: { input_tokens: 3, output_tokens: 2 },
				},
			}),
		);
		while (events.length < 3 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.deepEqual(
			events.map((event) => event.kind),
			["output_audio", "usage", "turn_complete"],
		);

		// A new configuration is applied on the same connection.
		await session.reconfigure(
			config({ vad: null, instructions: "Now terse." }),
		);
		assert.equal(received.at(-1)?.session.instructions, "Now terse.");
		assert.equal(server.clients.size, 1);
		session.cancelResponse?.();
		session.sendFunctionResults([{ id: "call_1", name: "f", output: "ok" }]);
		while (received.length < 9 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		assert.deepEqual(types().slice(-3), [
			"response.cancel",
			"conversation.item.create",
			"response.create",
		]);
		session.close();
		await reading;
	} finally {
		for (const client of server.clients) {
			client.terminate();
		}
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
