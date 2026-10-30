import { redisAvailable, pgAvailable } from "#test-support/infra.ts";
import { type WebSocketServerLike, serve } from "@hono/node-server";
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

test("GET /v1/realtime refuses conversation sessions before upgrading", {
	skip,
}, async () => {
	const server = await gateway();
	let virtualKey: CreatedVirtualKey | undefined;
	try {
		virtualKey = await createVirtualKey({
			name: `realtime-intent-${randomUUID()}`,
		});
		const status = await new Promise<number>((resolve, reject) => {
			const socket = new WebSocket(`${server.url}?model=gpt-realtime`, {
				headers: { authorization: `Bearer ${virtualKey?.rawKey}` },
			});
			socket.once("unexpected-response", (_request, response) =>
				resolve(response.statusCode ?? 0),
			);
			socket.once("open", () => reject(new Error("upgraded")));
		});
		assert.equal(status, 400);
	} finally {
		if (virtualKey) {
			await deleteVirtualKey(virtualKey.row.id);
		}
		await server.close();
	}
});
