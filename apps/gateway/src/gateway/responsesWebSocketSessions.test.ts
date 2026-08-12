import { ResponsesWebSocketUpstreams } from "./responsesWebSocketSessions.ts";
import type { DeploymentCandidate } from "./deploymentCandidates.ts";
import type { AdapterContext, Adapter } from "#adapters/types.ts";
import { GatewayError } from "#core/errors.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import type {
	CanonicalChatStreamChunk,
	CanonicalChatRequest,
} from "#core/canonical.ts";

async function* completedTurn(): AsyncIterable<CanonicalChatStreamChunk> {
	yield {
		id: "response_1",
		created: 1,
		model: "gpt-5.6",
		choices: [
			{ index: 0, delta: { content: "completed" }, finishReason: null },
		],
	};
	yield {
		id: "response_1",
		created: 1,
		model: "gpt-5.6",
		choices: [{ index: 0, delta: {}, finishReason: "stop" }],
	};
}

test("responses websocket sessions: private upstream ids continue only on the bound deployment", async () => {
	const seen: Array<{
		request: CanonicalChatRequest;
		previousResponseId?: string;
	}> = [];
	const adapter = {
		key: "fake",
		credentials: { required: [] },
		supportedCallTypes: new Set(["chat"]),
		responsesWebSocket: {
			async connect() {
				return {
					closed: false,
					async create(
						request: CanonicalChatRequest,
						options: {
							previousResponseId?: string;
							generate: boolean;
							signal: AbortSignal;
						},
					) {
						seen.push({
							request,
							...(options.previousResponseId
								? { previousResponseId: options.previousResponseId }
								: {}),
						});
						return {
							chunks: completedTurn(),
							upstreamResponseId: Promise.resolve(`upstream_${seen.length}`),
						};
					},
					close() {},
				};
			},
		},
	} as unknown as Adapter;
	const candidate = {
		row: { id: "deployment_1" },
		adapter,
	} as DeploymentCandidate;
	const context = {
		transport: "responses",
		upstreamModel: "gpt-5.6",
		meta: {},
		credentials: {},
		requestId: "req_1",
		signal: new AbortController().signal,
	} as AdapterContext;
	const request = {
		callType: "chat",
		model: "public",
		messages: [{ role: "user", content: "full context" }],
		stream: true,
		responsesTransport: {
			rawInput: [{ type: "message", role: "user", content: "full context" }],
		},
	} as unknown as CanonicalChatRequest;
	const sessions = new ResponsesWebSocketUpstreams();

	const first = await sessions.execute(candidate, context, request, {
		currentRawInput: [{ type: "message", role: "user", content: "first" }],
		previousPublicResponseId: null,
		generate: true,
	});
	assert.equal(first.kind, "stream");
	if (first.kind === "stream") {
		for await (const _chunk of first.chunks) {
			// The fake first turn is empty.
		}
	}
	sessions.commit(
		"deployment_1",
		"resp_public_1",
		first.kind === "stream" ? first.upstreamResponseId : undefined,
	);
	await Promise.resolve();

	await sessions.execute(candidate, context, request, {
		currentRawInput: [
			{ type: "function_call_output", call_id: "call_1", output: "done" },
		],
		previousPublicResponseId: "resp_public_1",
		generate: true,
	});
	assert.equal(seen[1]?.previousResponseId, "upstream_1");
	assert.deepEqual(seen[1]?.request.responsesTransport?.rawInput, [
		{ type: "function_call_output", call_id: "call_1", output: "done" },
	]);
	sessions.invalidate("resp_public_1");
	await sessions.execute(candidate, context, request, {
		currentRawInput: [
			{ type: "function_call_output", call_id: "call_1", output: "retry" },
		],
		previousPublicResponseId: "resp_public_1",
		generate: true,
	});
	assert.equal(seen[2]?.previousResponseId, undefined);
	assert.deepEqual(
		seen[2]?.request.responsesTransport?.rawInput,
		request.responsesTransport?.rawInput,
	);
	sessions.close();
});

test("responses websocket sessions: rehydrates full canonical input when upstream state was evicted", async () => {
	const seen: Array<{
		request: CanonicalChatRequest;
		previousResponseId?: string;
	}> = [];
	const adapter = {
		key: "fake",
		credentials: { required: [] },
		supportedCallTypes: new Set(["chat"]),
		responsesWebSocket: {
			async connect() {
				return {
					closed: false,
					async create(
						request: CanonicalChatRequest,
						options: { previousResponseId?: string },
					) {
						seen.push({
							request,
							...(options.previousResponseId
								? { previousResponseId: options.previousResponseId }
								: {}),
						});
						const call = seen.length;
						return {
							chunks:
								call === 2
									? (async function* () {
											yield* [];
											throw new GatewayError({
												class: "bad_request",
												code: "previous_response_not_found",
												message: "evicted",
											});
										})()
									: completedTurn(),
							upstreamResponseId: Promise.resolve(`upstream_${call}`),
						};
					},
					close() {},
				};
			},
		},
	} as unknown as Adapter;
	const candidate = {
		row: { id: "deployment_1" },
		adapter,
	} as DeploymentCandidate;
	const context = {
		transport: "responses",
		upstreamModel: "gpt-5.6",
		meta: {},
		credentials: {},
		requestId: "req_1",
		signal: new AbortController().signal,
	} as AdapterContext;
	const request = {
		callType: "chat",
		model: "public",
		messages: [{ role: "user", content: "full context" }],
		stream: true,
		responsesTransport: {
			rawInput: [{ type: "message", role: "user", content: "full context" }],
		},
	} as unknown as CanonicalChatRequest;
	const sessions = new ResponsesWebSocketUpstreams();
	const first = await sessions.execute(candidate, context, request, {
		currentRawInput: [{ type: "message", role: "user", content: "first" }],
		previousPublicResponseId: null,
		generate: true,
	});
	if (first.kind === "stream") {
		for await (const _chunk of first.chunks) {
			// The fake first turn is empty.
		}
	}
	sessions.commit(
		"deployment_1",
		"resp_public_1",
		first.kind === "stream" ? first.upstreamResponseId : undefined,
	);
	await Promise.resolve();
	const continued = await sessions.execute(candidate, context, request, {
		currentRawInput: [
			{ type: "function_call_output", call_id: "call_1", output: "done" },
		],
		previousPublicResponseId: "resp_public_1",
		generate: true,
	});
	assert.equal(continued.kind, "stream");
	if (continued.kind === "stream") {
		for await (const _chunk of continued.chunks) {
			// The recovery stream is intentionally empty in this fake.
		}
		assert.equal(await continued.upstreamResponseId, "upstream_3");
	}
	assert.equal(seen[1]?.previousResponseId, "upstream_1");
	assert.equal(seen[2]?.previousResponseId, undefined);
	assert.deepEqual(
		seen[2]?.request.responsesTransport?.rawInput,
		request.responsesTransport?.rawInput,
	);
	sessions.close();
});

test("responses websocket sessions: generate:false stays local for providers without native WebSockets", async () => {
	const candidate = {
		row: { id: "deployment_1" },
		adapter: {
			key: "fake",
			credentials: { required: [] },
			supportedCallTypes: new Set(["chat"]),
		} as unknown as Adapter,
	} as DeploymentCandidate;
	const context = {
		transport: "messages",
		upstreamModel: "claude-test",
		meta: {},
		credentials: {},
		requestId: "req_1",
		signal: new AbortController().signal,
	} as AdapterContext;
	const sessions = new ResponsesWebSocketUpstreams();
	const result = await sessions.execute(
		candidate,
		context,
		{
			callType: "chat",
			model: "public",
			messages: [{ role: "user", content: "warm up" }],
			stream: true,
		},
		{
			currentRawInput: [{ type: "message", role: "user", content: "warm up" }],
			previousPublicResponseId: null,
			generate: false,
		},
	);
	assert.equal(result.kind, "stream");
	if (result.kind === "stream") {
		const chunks: CanonicalChatStreamChunk[] = [];
		for await (const chunk of result.chunks) chunks.push(chunk);
		assert.equal(chunks.length, 2);
		assert.deepEqual(chunks[0]?.choices[0]?.delta, {});
		assert.equal(chunks[0]?.choices[0]?.finishReason, null);
		assert.deepEqual(chunks[0]?.usage, {
			promptTokens: 0,
			completionTokens: 0,
			totalTokens: 0,
		});
		assert.equal(chunks[1]?.choices[0]?.finishReason, "stop");
	}
	sessions.close();
});
