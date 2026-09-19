import assert from "node:assert/strict";
import { test } from "node:test";
import { streamText } from "ai";

import {
	type PlaygroundSettings,
	createSessionFetch,
	type FetchLike,
	emptySettings,
	modelFor,
} from "./api";

const settings: PlaygroundSettings = {
	systemPrompt: "Be concise",
	parameters: { temperature: 0, max_tokens: 37, top_p: 0.25 },
	reasoningEffort: "high",
	stopSequences: ["<end>"],
};

function streamResponse(body: string): Response {
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

function jsonStream(events: unknown[]): Response {
	return streamResponse(
		events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n") +
			"\n\n",
	);
}

function fixture(endpoint: keyof typeof fixtures): Response {
	return fixtures[endpoint];
}

const fixtures = {
	"chat.completions": streamResponse(
		`data: {"id":"chat-1","created":1,"model":"model","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}

data: {"id":"chat-1","created":1,"model":"model","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}

data: [DONE]

`,
	),
	responses: jsonStream([
		{
			type: "response.created",
			response: { id: "response-1", created_at: 1, model: "model" },
		},
		{
			type: "response.output_item.added",
			output_index: 0,
			item: { type: "message", id: "message-1" },
		},
		{
			type: "response.output_text.delta",
			item_id: "message-1",
			output_index: 0,
			delta: "ok",
		},
		{
			type: "response.output_item.done",
			output_index: 0,
			item: { type: "message", id: "message-1" },
		},
		{
			type: "response.completed",
			response: {
				usage: {
					input_tokens: 2,
					input_tokens_details: { cached_tokens: 0 },
					output_tokens: 1,
					output_tokens_details: { reasoning_tokens: 0 },
					total_tokens: 3,
				},
			},
		},
	]),
	messages: jsonStream([
		{
			type: "message_start",
			message: {
				id: "message-1",
				model: "model",
				role: "assistant",
				content: [],
				usage: { input_tokens: 2 },
			},
		},
		{
			type: "content_block_start",
			index: 0,
			content_block: { type: "text", text: "" },
		},
		{
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "ok" },
		},
		{ type: "content_block_stop", index: 0 },
		{
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: { input_tokens: 2, output_tokens: 1 },
		},
		{ type: "message_stop" },
	]),
};

test("session fetch includes the browser session and removes provider credentials", async () => {
	let input: Parameters<typeof fetch>[0] | undefined;
	let init: RequestInit | undefined;
	const fetchImpl: FetchLike = async (request, requestInit) => {
		input = request;
		init = requestInit;
		return new Response("{}", { status: 200 });
	};

	const request = createSessionFetch("chat.completions", settings, {
		fetch: fetchImpl,
		csrf: () => "csrf-from-test",
	});
	await request("https://gateway.test/v1/chat/completions", {
		method: "POST",
		headers: {
			Authorization: "Bearer dummy",
			"x-api-key": "dummy",
			"content-type": "application/json",
		},
		body: JSON.stringify({ model: "model", messages: [] }),
	});

	assert.equal(input, "https://gateway.test/v1/chat/completions");
	assert.equal(init?.credentials, "include");
	const headers = new Headers(init?.headers);
	assert.equal(headers.get("authorization"), null);
	assert.equal(headers.get("x-api-key"), null);
	assert.equal(headers.get("x-csrf-token"), "csrf-from-test");
});

test("session fetch restores explicit settings after SDK filtering", async () => {
	for (const endpoint of [
		"chat.completions",
		"responses",
		"messages",
	] as const) {
		let body: Record<string, unknown> | undefined;
		const request = createSessionFetch(endpoint, settings, {
			fetch: async (_input, init) => {
				body = JSON.parse(String(init?.body)) as Record<string, unknown>;
				return new Response("{}", { status: 200 });
			},
		});
		await request("https://gateway.test", {
			method: "POST",
			body: JSON.stringify({
				model: "model",
				temperature: 1,
				max_completion_tokens: 999,
				output_config: { format: "text" },
			}),
		});
		assert.equal(body?.temperature, 0, endpoint);
		assert.equal(body?.top_p, 0.25, endpoint);
		assert.equal(
			body?.store,
			endpoint === "messages" ? undefined : false,
			endpoint,
		);
		if (endpoint === "chat.completions") {
			assert.equal(body.max_tokens, 37);
			assert.equal(body.max_completion_tokens, undefined);
			assert.equal(body.reasoning_effort, "high");
			assert.deepEqual(body.stop, ["<end>"]);
		}
		if (endpoint === "responses") {
			assert.equal(body.max_output_tokens, 37);
			assert.deepEqual(body.reasoning, { effort: "high", summary: "auto" });
			assert.deepEqual(body.stop, ["<end>"]);
		}
		if (endpoint === "messages") {
			assert.equal(body.max_tokens, 37);
			assert.deepEqual(body.stop_sequences, ["<end>"]);
			assert.deepEqual(body.output_config, { format: "text", effort: "high" });
			assert.deepEqual(body.thinking, {
				type: "adaptive",
				display: "summarized",
			});
		}
	}
});

test("modelFor uses each real AI SDK provider while preserving the gateway request", async () => {
	for (const endpoint of [
		"chat.completions",
		"responses",
		"messages",
	] as const) {
		let body: Record<string, unknown> | undefined;
		let requestHeaders: Headers | undefined;
		const fetchImpl: FetchLike = async (_input, init) => {
			body = JSON.parse(String(init?.body)) as Record<string, unknown>;
			requestHeaders = new Headers(init?.headers);
			return fixture(endpoint);
		};
		const result = streamText({
			model: modelFor(endpoint, "model", settings, {
				baseURL: "https://gateway.test/v1",
				csrf: () => "csrf-token",
				fetch: fetchImpl,
			}),
			messages: [{ role: "user", content: "hello" }],
			maxOutputTokens: 37,
			temperature: 0,
		});

		const text = await result.text;
		if (endpoint !== "responses") {
			assert.equal(text, "ok", endpoint);
		}
		assert.equal(body?.temperature, 0, endpoint);
		assert.equal(
			body?.store,
			endpoint === "messages" ? undefined : false,
			endpoint,
		);
		assert.equal(requestHeaders?.get("authorization"), null, endpoint);
		assert.equal(requestHeaders?.get("x-api-key"), null, endpoint);
		assert.equal(requestHeaders?.get("x-csrf-token"), "csrf-token", endpoint);
		if (endpoint === "chat.completions") {
			assert.equal(body.max_tokens, 37);
			assert.equal(body.reasoning_effort, "high");
		}
		if (endpoint === "responses") {
			assert.equal(body.max_output_tokens, 37);
			assert.deepEqual(body.reasoning, { effort: "high", summary: "auto" });
		}
		if (endpoint === "messages") {
			assert.equal(body.max_tokens, 37);
			assert.deepEqual(body.output_config, { effort: "high" });
			assert.deepEqual(body.thinking, {
				type: "adaptive",
				display: "summarized",
			});
		}
	}
});

test("empty settings do not invent a browser-only CSRF token", async () => {
	let csrfHeader: string | null | undefined;
	const request = createSessionFetch("responses", emptySettings(), {
		csrf: () => undefined,
		fetch: async (_input, init) => {
			csrfHeader = new Headers(init?.headers).get("x-csrf-token");
			return new Response("{}", { status: 200 });
		},
	});
	await request("https://gateway.test", {
		method: "POST",
		body: JSON.stringify({}),
	});
	assert.equal(csrfHeader, null);
});

test("a relative base URL is resolved against the page origin for every provider", async () => {
	// `@ai-sdk/openai-compatible` builds its address with `new URL()` and throws on a bare path,
	// which is exactly what the playground passes (`/api/v1`, this app's own relay).
	const original = Reflect.get(globalThis, "window");
	Reflect.set(globalThis, "window", {
		location: { origin: "https://dash.test" },
	});
	try {
		for (const endpoint of [
			"chat.completions",
			"responses",
			"messages",
		] as const) {
			let requested: string | undefined;
			const result = streamText({
				model: modelFor(endpoint, "model", emptySettings(), {
					baseURL: "/api/v1",
					csrf: () => undefined,
					fetch: async (input) => {
						requested = String(input);
						return streamResponse("");
					},
				}),
				messages: [{ role: "user", content: "hello" }],
				onError: () => {
					/* Reported through the awaited promise below, not the console. */
				},
			});
			// The address is the assertion; an empty stream is enough to reach it.
			try {
				await result.text;
			} catch {
				/* An empty stream never finishes; the address is already recorded. */
			}
			assert.equal(
				requested?.startsWith("https://dash.test/api/v1/"),
				true,
				`${endpoint}: ${requested}`,
			);
		}
	} finally {
		if (original === undefined) {
			Reflect.deleteProperty(globalThis, "window");
		} else {
			Reflect.set(globalThis, "window", original);
		}
	}
});
