import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { type WebSocketServerLike, serve } from "@hono/node-server";
import { realtimeClientSecretsHandler } from "#endpoints/realtimeClientSecrets.ts";
import { realtimeWebSocketHandler } from "#endpoints/realtime.ts";
import { makeOpenAIContractTestApp } from "#test-support/app.ts";
import { deleteDeployment } from "#db/repos/deployments.ts";
import { createDeployment } from "#deployments/service.ts";
import { eventually } from "#test-support/wait.ts";
import { WebSocket, WebSocketServer } from "ws";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	type CreatedVirtualKey,
	createVirtualKey,
	deleteVirtualKey,
} from "#db/repos/virtualKeys.ts";

import {
	listOperationsPage,
	getOperationDetail,
} from "#db/repos/operations.ts";

import "#adapters/index.ts";

const hasInfra = (await pgAvailable()) && (await redisAvailable());
const skip = hasInfra ? false : "Postgres/Redis unavailable";

/** A Gemini Live stand-in: acknowledges setup, then transcribes each manual utterance. */
async function geminiStub() {
	const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const setups: Record<string, any>[] = [];
	let audioBytes = 0;
	server.on("connection", (socket) => {
		socket.on("message", (data) => {
			const message = JSON.parse(data.toString()) as Record<string, any>;
			if (message.setup) {
				setups.push(message.setup);
				socket.send(JSON.stringify({ setupComplete: {} }));
				return;
			}
			const input = message.realtimeInput ?? {};
			if (input.audio) {
				audioBytes += Buffer.from(input.audio.data, "base64").byteLength;
			}
			if (input.activityEnd) {
				socket.send(
					JSON.stringify({
						serverContent: { interimInputTranscription: { text: "Hola" } },
					}),
				);
				socket.send(
					JSON.stringify({
						serverContent: { inputTranscription: { text: "Hola Bifrost." } },
						usageMetadata: {
							promptTokenCount: 5,
							responseTokenCount: 4,
							promptTokensDetails: [{ modality: "AUDIO", tokenCount: 5 }],
						},
					}),
				);
			}
		});
	});
	const { port } = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${port}/v1beta`,
		setups,
		audioBytes: () => audioBytes,
		close: () =>
			new Promise<void>((resolve) => {
				for (const connection of server.clients) {
					connection.terminate();
				}
				server.close(() => resolve());
			}),
	};
}

async function gateway() {
	const app = makeOpenAIContractTestApp((testApp) => {
		testApp.get("/v1/realtime", realtimeWebSocketHandler);
		testApp.post("/v1/realtime/client_secrets", realtimeClientSecretsHandler);
	});
	const webSocketServer = new WebSocketServer({ noServer: true });
	const server = serve({
		fetch: app.fetch,
		port: 0,
		hostname: "127.0.0.1",
		websocket: { server: webSocketServer as WebSocketServerLike },
	});
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `ws://127.0.0.1:${port}/v1/realtime`,
		app,
		close: () =>
			new Promise<void>((resolve) => {
				for (const socket of webSocketServer.clients) {
					socket.terminate();
				}
				server.close(() => resolve());
				(
					server as { closeAllConnections?: () => void }
				).closeAllConnections?.();
			}),
	};
}

/** A connected client that records every server event. */
async function client(url: string, key: string) {
	const socket = new WebSocket(url, {
		headers: { authorization: `Bearer ${key}` },
	});
	const events: Record<string, any>[] = [];
	socket.on("message", (data) => events.push(JSON.parse(data.toString())));
	await new Promise<void>((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", reject);
	});
	const next = (type: string) =>
		eventually(() => events.find((event) => event.type === type), {
			description: type,
		});
	return { socket, events, next };
}

test("GET /v1/realtime transcribes a manual turn through Gemini Live and logs its usage", {
	skip,
	timeout: 30_000,
}, async () => {
	const stub = await geminiStub();
	const server = await gateway();
	const publicModel = `realtime-e2e-${randomUUID()}`;
	let deploymentId: string | undefined;
	let virtualKey: CreatedVirtualKey | undefined;
	try {
		const created = await createDeployment({
			publicModel,
			adapterKey: "googleaistudio",
			upstreamModel: "gemini-3.5-transcribe-live",
			credentials: { apiKey: "gemini-test", baseUrl: stub.baseUrl },
		});
		deploymentId = created.row.id;
		virtualKey = await createVirtualKey({
			name: `realtime-e2e-${randomUUID()}`,
			allowedModels: [publicModel],
		});

		const { socket, events, next } = await client(
			`${server.url}?intent=transcription`,
			virtualKey.rawKey,
		);
		const createdEvent = await next("session.created");
		assert.equal(createdEvent.session.type, "transcription");

		socket.send(
			JSON.stringify({
				type: "session.update",
				session: {
					type: "transcription",
					audio: {
						input: {
							format: { type: "audio/pcm", rate: 24_000 },
							transcription: {
								model: publicModel,
								keywords: ["Bifrost"],
								languages: ["es-419"],
							},
							turn_detection: null,
						},
					},
				},
			}),
		);
		const updated = await next("session.updated");
		assert.equal(updated.session.audio.input.turn_detection, null);
		assert.deepEqual(stub.setups[0]?.inputAudioTranscription, {
			languageCodes: ["es-419"],
			customVocabulary: ["Bifrost"],
		});

		// 200 ms at 24 kHz becomes 200 ms at 16 kHz upstream.
		socket.send(
			JSON.stringify({
				type: "input_audio_buffer.append",
				audio: Buffer.alloc(9600).toString("base64"),
			}),
		);
		socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
		const completed = await next(
			"conversation.item.input_audio_transcription.completed",
		);
		assert.equal(completed.transcript, "Hola Bifrost.");
		assert.deepEqual(completed.usage, {
			type: "tokens",
			input_tokens: 5,
			input_token_details: { audio_tokens: 5 },
			output_tokens: 4,
			total_tokens: 9,
		});
		assert.ok(
			Math.abs(stub.audioBytes() - 6400) <= 4,
			String(stub.audioBytes()),
		);
		const order = events.map((event) => event.type);
		assert.ok(
			order.indexOf("input_audio_buffer.committed") <
				order.indexOf("conversation.item.input_audio_transcription.completed"),
		);
		const deltas = events
			.filter(
				(event) =>
					event.type === "conversation.item.input_audio_transcription.delta",
			)
			.map((event) => event.delta)
			.join("");
		assert.equal(deltas, "Hola Bifrost.");

		// A model the key may not use is refused without touching the session.
		socket.send(
			JSON.stringify({
				type: "session.update",
				event_id: "evt_denied",
				session: {
					type: "transcription",
					audio: { input: { transcription: { model: "another-model" } } },
				},
			}),
		);
		const error = await next("error");
		assert.equal(error.error.event_id, "evt_denied");

		socket.close();
		const operation = await eventually(
			async () => {
				const page = await listOperationsPage({
					limit: 1,
					offset: 0,
					publicModel,
					callType: "realtime.transcription",
				});
				const [row] = page.rows;
				const detail = row ? await getOperationDetail(row.id) : null;
				return detail?.outcome ? detail : null;
			},
			{ description: "realtime gateway_operation", timeoutMs: 8000 },
		);
		assert.equal(operation.outcome, "success");
		assert.equal(operation.promptTokens, 5);
		assert.equal(operation.completionTokens, 4);
		assert.equal(operation.callType, "realtime.transcription");
		assert.ok(operation.firstOutputMs !== null);
	} finally {
		if (virtualKey) {
			await deleteVirtualKey(virtualKey.row.id);
		}
		if (deploymentId) {
			await deleteDeployment(deploymentId);
		}
		await server.close();
		await stub.close();
	}
});

test("GET /v1/realtime refuses unknown intents and conversations without a model before upgrading", {
	skip,
}, async () => {
	const server = await gateway();
	let virtualKey: CreatedVirtualKey | undefined;
	try {
		virtualKey = await createVirtualKey({
			name: `realtime-intent-${randomUUID()}`,
		});
		for (const query of [
			"?intent=bogus&model=m",
			"",
			"?intent=transcription&model=m",
		]) {
			const status = await new Promise<number>((resolve, reject) => {
				const socket = new WebSocket(`${server.url}${query}`, {
					headers: { authorization: `Bearer ${virtualKey?.rawKey}` },
				});
				socket.once("unexpected-response", (_request, response) =>
					resolve(response.statusCode ?? 0),
				);
				socket.once("open", () => reject(new Error(`upgraded ${query}`)));
			});
			assert.equal(status, 400, query);
		}
	} finally {
		if (virtualKey) {
			await deleteVirtualKey(virtualKey.row.id);
		}
		await server.close();
	}
});

/** A Gemini Live conversation stand-in: answers turns with speech, and asks for one function. */
async function geminiConversationStub() {
	const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
	await new Promise<void>((resolve) => server.once("listening", resolve));
	const received: Record<string, any>[] = [];
	const speak = (socket: WebSocket, text: string, tokens: number) => {
		socket.send(
			JSON.stringify({
				serverContent: {
					modelTurn: {
						parts: [
							{
								inlineData: {
									mimeType: "audio/pcm;rate=24000",
									data: Buffer.alloc(4800).toString("base64"),
								},
							},
						],
					},
					outputTranscription: { text },
				},
			}),
		);
		socket.send(
			JSON.stringify({
				serverContent: { turnComplete: true },
				usageMetadata: {
					promptTokenCount: tokens,
					responseTokenCount: 10,
					promptTokensDetails: [{ modality: "AUDIO", tokenCount: tokens }],
					responseTokensDetails: [{ modality: "AUDIO", tokenCount: 10 }],
				},
				sessionResumptionUpdate: { newHandle: "h", resumable: true },
			}),
		);
	};
	server.on("connection", (socket) => {
		socket.on("message", (data) => {
			const message = JSON.parse(data.toString()) as Record<string, any>;
			received.push(message);
			if (message.setup) {
				socket.send(JSON.stringify({ setupComplete: {} }));
				return;
			}
			if (message.realtimeInput?.activityEnd) {
				socket.send(
					JSON.stringify({
						serverContent: { inputTranscription: { text: "Hola" } },
					}),
				);
				speak(socket, "Hola, te ayudo.", 20);
			}
			if (message.clientContent?.turnComplete) {
				socket.send(
					JSON.stringify({
						toolCall: {
							functionCalls: [
								{ id: "fc_1", name: "order_status", args: { id: "7" } },
							],
						},
					}),
				);
			}
			if (message.toolResponse) {
				speak(socket, "Tu pedido ya salio.", 30);
			}
		});
	});
	const { port } = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${port}/v1beta`,
		received,
		close: () =>
			new Promise<void>((resolve) => {
				for (const connection of server.clients) {
					connection.terminate();
				}
				server.close(() => resolve());
			}),
	};
}

test("GET /v1/realtime?model= reports a refused session once, not once per audio chunk", {
	skip,
	timeout: 30_000,
}, async () => {
	const stub = await geminiConversationStub();
	const server = await gateway();
	const publicModel = `realtime-refused-${randomUUID()}`;
	let deploymentId: string | undefined;
	let virtualKey: CreatedVirtualKey | undefined;
	try {
		deploymentId = (
			await createDeployment({
				publicModel,
				adapterKey: "googleaistudio",
				upstreamModel: "gemini-3.8-live",
				credentials: { apiKey: "gemini-test", baseUrl: stub.baseUrl },
			})
		).row.id;
		virtualKey = await createVirtualKey({
			name: `realtime-refused-${randomUUID()}`,
			allowedModels: [publicModel],
		});
		const { socket, events, next } = await client(
			`${server.url}?model=${publicModel}`,
			virtualKey.rawKey,
		);
		await next("session.created");
		socket.send(
			JSON.stringify({
				type: "session.update",
				session: { type: "realtime", audio: { output: { voice: "alloy" } } },
			}),
		);
		await next("session.updated");
		for (let index = 0; index < 5; index += 1) {
			socket.send(
				JSON.stringify({
					type: "input_audio_buffer.append",
					audio: Buffer.alloc(4800).toString("base64"),
				}),
			);
		}
		const error = await next("error");
		assert.equal(error.error.param, "session.audio.output.voice");
		assert.match(error.error.message, /Kore/);
		await new Promise((resolve) => setTimeout(resolve, 200));
		assert.equal(events.filter((event) => event.type === "error").length, 1);
		assert.equal(stub.received.length, 0);
		socket.close();
		const page = await listOperationsPage({
			limit: 10,
			offset: 0,
			publicModel,
			callType: "realtime.conversation",
		});
		assert.equal(page.rows.length, 1);
	} finally {
		if (virtualKey) {
			await deleteVirtualKey(virtualKey.row.id);
		}
		if (deploymentId) {
			await deleteDeployment(deploymentId);
		}
		await server.close();
		await stub.close();
	}
});

test("GET /v1/realtime?model= holds a spoken conversation with a function call through Gemini Live", {
	skip,
	timeout: 30_000,
}, async () => {
	const stub = await geminiConversationStub();
	const server = await gateway();
	const publicModel = `realtime-conv-${randomUUID()}`;
	let deploymentId: string | undefined;
	let virtualKey: CreatedVirtualKey | undefined;
	try {
		const created = await createDeployment({
			publicModel,
			adapterKey: "googleaistudio",
			upstreamModel: "gemini-3.8-live",
			credentials: { apiKey: "gemini-test", baseUrl: stub.baseUrl },
		});
		deploymentId = created.row.id;
		virtualKey = await createVirtualKey({
			name: `realtime-conv-${randomUUID()}`,
			allowedModels: [publicModel],
		});

		// Browser-style authentication: the key travels as a WebSocket subprotocol.
		const socket = new WebSocket(`${server.url}?model=${publicModel}`, [
			"realtime",
			`openai-insecure-api-key.${virtualKey.rawKey}`,
		]);
		const events: Record<string, any>[] = [];
		socket.on("message", (data) => events.push(JSON.parse(data.toString())));
		await new Promise<void>((resolve, reject) => {
			socket.once("open", () => resolve());
			socket.once("unexpected-response", (_request, response) =>
				reject(new Error(`upgrade refused: ${response.statusCode}`)),
			);
			socket.once("error", reject);
		});
		assert.equal(socket.protocol, "realtime");
		const nth = (type: string, n: number) =>
			eventually(() => events.filter((event) => event.type === type)[n - 1], {
				description: `${type} #${n}`,
			});
		const createdEvent = await nth("session.created", 1);
		assert.equal(createdEvent.session.type, "realtime");
		assert.equal(createdEvent.session.model, publicModel);

		socket.send(
			JSON.stringify({
				type: "session.update",
				session: {
					type: "realtime",
					instructions: "Eres un asistente de pedidos.",
					audio: {
						input: {
							transcription: { model: "gpt-transcribe" },
							turn_detection: null,
						},
						output: { voice: "Kore" },
					},
					tools: [
						{
							type: "function",
							name: "order_status",
							parameters: {
								type: "object",
								properties: { id: { type: "string" } },
							},
						},
					],
				},
			}),
		);
		await nth("session.updated", 1);

		// A manual voice turn.
		socket.send(
			JSON.stringify({
				type: "input_audio_buffer.append",
				audio: Buffer.alloc(9600).toString("base64"),
			}),
		);
		socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
		socket.send(JSON.stringify({ type: "response.create" }));
		const first = await nth("response.done", 1);
		assert.equal(first.response.status, "completed");
		assert.equal(
			first.response.output[0].content[0].transcript,
			"Hola, te ayudo.",
		);
		assert.equal(first.response.usage.input_tokens, 20);
		const setup = stub.received.find((message) => message.setup)?.setup;
		assert.deepEqual(setup.systemInstruction, {
			parts: [{ text: "Eres un asistente de pedidos." }],
		});
		assert.equal(
			setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig
				.voiceName,
			"Kore",
		);
		assert.deepEqual(setup.realtimeInputConfig, {
			automaticActivityDetection: { disabled: true },
		});
		const audio = events.find(
			(event) => event.type === "response.output_audio.delta",
		);
		assert.equal(Buffer.from(audio?.delta, "base64").byteLength, 4800);
		const transcript = await nth(
			"conversation.item.input_audio_transcription.completed",
			1,
		);
		assert.equal(transcript.transcript, "Hola");

		// A text turn that makes the model call a function.
		socket.send(
			JSON.stringify({
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "Y mi pedido 7?" }],
				},
			}),
		);
		socket.send(JSON.stringify({ type: "response.create" }));
		const call = await nth("response.function_call_arguments.done", 1);
		assert.equal(call.call_id, "fc_1");
		assert.equal(call.arguments, '{"id":"7"}');
		await nth("response.done", 2);
		socket.send(
			JSON.stringify({
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: "fc_1",
					output: '{"status":"shipped"}',
				},
			}),
		);
		socket.send(JSON.stringify({ type: "response.create" }));
		const last = await nth("response.done", 3);
		assert.equal(
			last.response.output[0].content[0].transcript,
			"Tu pedido ya salio.",
		);
		assert.deepEqual(
			stub.received.find((message) => message.toolResponse)?.toolResponse,
			{
				functionResponses: [
					{
						id: "fc_1",
						name: "order_status",
						response: { status: "shipped" },
					},
				],
			},
		);
		assert.deepEqual(
			events.filter((event) => event.type === "error"),
			[],
		);

		socket.close();
		const operation = await eventually(
			async () => {
				const page = await listOperationsPage({
					limit: 1,
					offset: 0,
					publicModel,
					callType: "realtime.conversation",
				});
				const [row] = page.rows;
				const detail = row ? await getOperationDetail(row.id) : null;
				return detail?.outcome ? detail : null;
			},
			{ description: "realtime conversation operation", timeoutMs: 8000 },
		);
		assert.equal(operation.outcome, "success");
		assert.equal(operation.promptTokens, 50);
		assert.equal(operation.completionTokens, 20);
		assert.ok(operation.firstOutputMs !== null);
	} finally {
		if (virtualKey) {
			await deleteVirtualKey(virtualKey.row.id);
		}
		if (deploymentId) {
			await deleteDeployment(deploymentId);
		}
		await server.close();
		await stub.close();
	}
});

test("POST /v1/realtime/client_secrets mints a key that only opens realtime sessions, preconfigured", {
	skip,
	timeout: 30_000,
}, async () => {
	const stub = await geminiConversationStub();
	const server = await gateway();
	const publicModel = `realtime-secret-${randomUUID()}`;
	const transcriptionModel = `realtime-secret-tx-${randomUUID()}`;
	const deploymentIds: string[] = [];
	let virtualKey: CreatedVirtualKey | undefined;
	try {
		deploymentIds.push(
			(
				await createDeployment({
					publicModel,
					adapterKey: "googleaistudio",
					upstreamModel: "gemini-3.8-live",
					credentials: { apiKey: "gemini-test", baseUrl: stub.baseUrl },
				})
			).row.id,
			(
				await createDeployment({
					publicModel: transcriptionModel,
					adapterKey: "googleaistudio",
					upstreamModel: "gemini-3.5-transcribe-live",
					credentials: { apiKey: "gemini-test", baseUrl: stub.baseUrl },
				})
			).row.id,
		);
		virtualKey = await createVirtualKey({
			name: `realtime-secret-${randomUUID()}`,
			allowedModels: [publicModel, transcriptionModel],
		});
		const mint = (body: unknown, key = virtualKey?.rawKey) =>
			server.app.request("/v1/realtime/client_secrets", {
				method: "POST",
				headers: {
					authorization: `Bearer ${key}`,
					"content-type": "application/json",
				},
				body: JSON.stringify(body),
			});

		const response = await mint({
			expires_after: { anchor: "created_at", seconds: 120 },
			session: {
				type: "realtime",
				model: publicModel,
				instructions: "Eres breve.",
				audio: { output: { voice: "Kore" } },
			},
		});
		assert.equal(response.status, 200);
		const secret = (await response.json()) as Record<string, any>;
		assert.match(secret.value, /^ek_/);
		assert.ok(
			Math.abs(secret.expires_at - (Date.now() / 1000 + 120)) < 5,
			String(secret.expires_at),
		);
		assert.equal(secret.session.model, publicModel);
		assert.equal(secret.session.audio.output.voice, "Kore");

		// The secret opens nothing but /v1/realtime.
		assert.equal((await mint({}, secret.value)).status, 401);
		// A model the key may not use is refused when minting.
		assert.equal(
			(await mint({ session: { type: "realtime", model: "another-model" } }))
				.status,
			403,
		);
		// So is a voice-less nonsense session shape.
		assert.equal(
			(await mint({ session: { type: "realtime", tools: [{ type: "x" }] } }))
				.status,
			400,
		);

		// A browser connects with the secret alone: the session starts from what was minted.
		const socket = new WebSocket(server.url, [
			"realtime",
			`openai-insecure-api-key.${secret.value}`,
		]);
		const events: Record<string, any>[] = [];
		socket.on("message", (data) => events.push(JSON.parse(data.toString())));
		await new Promise<void>((resolve, reject) => {
			socket.once("open", () => resolve());
			socket.once("unexpected-response", (_request, res) =>
				reject(new Error(`upgrade refused: ${res.statusCode}`)),
			);
			socket.once("error", reject);
		});
		const created = await eventually(
			() => events.find((event) => event.type === "session.created"),
			{ description: "session.created" },
		);
		assert.equal(created.session.model, publicModel);
		assert.equal(created.session.instructions, "Eres breve.");
		socket.send(
			JSON.stringify({
				type: "conversation.item.create",
				item: {
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "Hola" }],
				},
			}),
		);
		socket.send(JSON.stringify({ type: "response.create" }));
		await eventually(
			() =>
				events.find((event) => event.type === "response.done") ??
				events.find((event) => event.type === "error"),
			{ description: "first answer" },
		);
		const setup = stub.received.find((message) => message.setup)?.setup;
		assert.deepEqual(setup.systemInstruction, {
			parts: [{ text: "Eres breve." }],
		});
		assert.equal(
			setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig
				.voiceName,
			"Kore",
		);
		socket.close();

		// A transcription secret opens a transcription session without ?intent.
		const transcription = (await (
			await mint({
				session: {
					type: "transcription",
					audio: { input: { transcription: { model: transcriptionModel } } },
				},
			})
		).json()) as Record<string, any>;
		const { socket: txSocket, next } = await client(
			server.url,
			transcription.value,
		);
		const txCreated = await next("session.created");
		assert.equal(txCreated.session.type, "transcription");
		assert.equal(
			txCreated.session.audio.input.transcription.model,
			transcriptionModel,
		);
		txSocket.close();
	} finally {
		if (virtualKey) {
			await deleteVirtualKey(virtualKey.row.id);
		}
		for (const id of deploymentIds) {
			await deleteDeployment(id);
		}
		await server.close();
		await stub.close();
	}
});
