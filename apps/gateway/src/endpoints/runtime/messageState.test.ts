import { buildResponsesRequestBody } from "#contracts/openai/responsesTransport.ts";
import type { MessageStateDiscardReason } from "#core/providerSpecificFields.ts";
import { buildOpenAIChatBody } from "#contracts/openai/chatTransport.ts";
import { responsesRequestSchema } from "#contracts/openai/responses.ts";
import { jsonBody, must, streamOf } from "#test-support/adapters.ts";
import { createMessageStateCodec } from "./messageState.ts";
import { googleAdapter } from "#adapters/google/index.ts";
import { createCipheriv, randomBytes } from "node:crypto";
import type { AdapterContext } from "#adapters/types.ts";
import { encryptJson } from "#db/crypto.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	canonicalChunksToResponsesEvents,
	canonicalToResponsesResponse,
	responsesRequestToCanonical,
} from "#contracts/openai/responsesRender.ts";

type Item = Record<string, unknown>;

const ctx: AdapterContext = {
	upstreamModel: "gemini-3.5-pro",
	credentials: { apiKey: "AIza-test" },
	meta: {
		capabilities: {
			tools: true,
			vision: true,
			reasoning: true,
			structuredOutputs: true,
		},
		reasoning: { kind: "gemini_level", levels: ["low", "high"] },
	},
	transport: "generate_content",
	requestId: "t",
};
const chat = must(googleAdapter, "chat");
const INCLUDE = ["reasoning.encrypted_content"];

function recordingCodec() {
	const discarded: MessageStateDiscardReason[] = [];
	return {
		codec: createMessageStateCodec((reason) => discarded.push(reason)),
		discarded,
	};
}

function request(body: Item) {
	return responsesRequestSchema.parse({ model: "boberth", ...body });
}

/** A Gemini 3 text turn: optional thought summary, text, then the signature on an empty part. */
function geminiTurn(text: string, signature: string, thought?: string) {
	return {
		modelVersion: "gemini-3.5-pro",
		candidates: [
			{
				index: 0,
				finishReason: "STOP",
				content: {
					role: "model",
					parts: [
						...(thought === undefined
							? []
							: [{ text: thought, thought: true }]),
						{ text },
						{ text: "", thoughtSignature: signature },
					],
				},
			},
		],
		usageMetadata: {
			promptTokenCount: 1,
			candidatesTokenCount: 1,
			totalTokenCount: 2,
		},
	};
}

function render(raw: unknown, include: string[] | null = INCLUDE) {
	const { codec } = recordingCodec();
	return canonicalToResponsesResponse(chat.parseResponse(raw, ctx), {
		req: request({ input: "hi", ...(include ? { include } : {}) }),
		publicModel: "boberth",
		reasoningEffort: "high",
		messageState: codec,
	});
}

function outputOf(response: Item): Item[] {
	return response.output as Item[];
}

/**
 * What the Vercel AI SDK (v7, `store: false`) sends back for a turn: messages by id, reasoning
 * only when it has encrypted content (summary-only items are skipped with a warning).
 */
function aiSdkReplay(output: Item[]): Item[] {
	return output.flatMap((item): Item[] => {
		if (item.type === "message") {
			return [
				{
					role: "assistant",
					id: item.id,
					content: structuredClone(item.content),
				},
			];
		}
		if (
			item.type === "reasoning" &&
			typeof item.encrypted_content === "string"
		) {
			return [
				{
					type: "reasoning",
					id: item.id,
					encrypted_content: item.encrypted_content,
					summary: [],
				},
			];
		}
		if (item.type === "function_call") {
			return [
				{
					type: "function_call",
					call_id: item.call_id,
					name: item.name,
					arguments: item.arguments,
				},
			];
		}
		return [];
	});
}

function user(text: string): Item {
	return { role: "user", content: [{ type: "input_text", text }] };
}

function geminiBody(
	input: Item[],
	codec = recordingCodec().codec,
	body: Item = {},
) {
	const canonical = responsesRequestToCanonical(
		request({ input, store: false, include: INCLUDE, ...body }),
		{ messageState: codec },
	);
	return { canonical, body: jsonBody(chat.buildRequest(canonical, ctx)) };
}

test("message state: rendered after the message, with or without a thought summary", () => {
	const withSummary = outputOf(
		render(geminiTurn("¡Hola!", "sig-a", "Defining")),
	);
	assert.deepEqual(
		withSummary.map((item) => item.type),
		["reasoning", "message", "reasoning"],
	);
	assert.deepEqual(withSummary[0]?.summary, [
		{ type: "summary_text", text: "Defining" },
	]);
	assert.equal(withSummary[0]?.encrypted_content, undefined);
	const [, message, state] = withSummary;
	assert.ok(String(state?.encrypted_content).startsWith("bfrs_1."));
	assert.deepEqual(state?.summary, []);
	// LiteLLM-style clients keep their mirror.
	const mirror = message?.provider_specific_fields as Item | undefined;
	assert.ok(mirror?.google);

	const bare = outputOf(render(geminiTurn("¡Hola!", "sig-a")));
	assert.deepEqual(
		bare.map((item) => item.type),
		["message", "reasoning"],
	);
});

test("message state: not rendered unless the client asks for encrypted reasoning", () => {
	const output = outputOf(render(geminiTurn("¡Hola!", "sig-a"), null));
	assert.deepEqual(
		output.map((item) => item.type),
		["message"],
	);
});

test("message state: a turn whose only signature is on a function call needs no carrier", () => {
	const output = outputOf(
		render({
			candidates: [
				{
					index: 0,
					finishReason: "STOP",
					content: {
						parts: [
							{ text: "Voy a buscar." },
							{
								functionCall: { name: "search", args: { q: "x" } },
								thoughtSignature: "sig-fc",
							},
						],
					},
				},
			],
			usageMetadata: {},
		}),
	);
	assert.deepEqual(
		output.map((item) => item.type),
		["message", "function_call"],
	);
});

test("message state: streamed after the message closes, which the summary closes before", async () => {
	const sse = [
		{ parts: [{ text: "**Defining**", thought: true }] },
		{ parts: [{ text: "¡Hola," }] },
		{ parts: [{ text: " mundo!" }] },
		{ parts: [{ text: "", thoughtSignature: "sig-s" }], finishReason: "STOP" },
	]
		.map(
			({ parts, finishReason }) =>
				`data: ${JSON.stringify({
					candidates: [
						{
							index: 0,
							content: { role: "model", parts },
							...(finishReason ? { finishReason } : {}),
						},
					],
					...(finishReason
						? {
								usageMetadata: {
									promptTokenCount: 1,
									candidatesTokenCount: 1,
									totalTokenCount: 2,
								},
							}
						: {}),
				})}\n\n`,
		)
		.join("");
	const { codec } = recordingCodec();
	const events: Array<{ type: string; data: Item }> = [];
	for await (const event of canonicalChunksToResponsesEvents(
		chat.parseStream(streamOf(sse), ctx),
		{
			req: request({ input: "hi", stream: true, include: INCLUDE }),
			publicModel: "boberth",
			reasoningEffort: "high",
			messageState: codec,
		},
	)) {
		events.push({ type: event.event ?? "", data: JSON.parse(event.data) });
	}
	const types = events.map((event) => event.type);
	const doneItems = events
		.filter((event) => event.type === "response.output_item.done")
		.map((event) => event.data.item as Item);
	assert.deepEqual(
		doneItems.map((item) => item.type),
		["reasoning", "message", "reasoning"],
	);
	// The summary item still closes when the text starts.
	assert.ok(
		types.indexOf("response.output_item.done") <
			types.indexOf("response.output_text.delta"),
	);
	const completed = events.at(-1);
	assert.equal(completed?.type, "response.completed");
	const output = outputOf(completed?.data.response as Item);
	assert.deepEqual(
		output.map((item) => item.type),
		["reasoning", "message", "reasoning"],
	);
	assert.ok(String(output[2]?.encrypted_content).startsWith("bfrs_1."));

	// What a client replays from the stream reaches Gemini intact.
	const { body } = geminiBody([
		user("hi"),
		...aiSdkReplay(output),
		user("¿y?"),
	]);
	assert.deepEqual(body.contents[1].parts, [
		{ text: "**Defining**", thought: true },
		{ text: "¡Hola," },
		{ text: " mundo!" },
		{ text: "", thoughtSignature: "sig-s" },
	]);
});

test("message state: a three-turn AI SDK conversation replays each signature on its own turn", () => {
	const first = render(geminiTurn("Respuesta A", "sig-a", "Pensando A"));
	const second = render(geminiTurn("Respuesta B", "sig-b"));
	const input = [
		user("uno"),
		...aiSdkReplay(outputOf(first)),
		user("dos"),
		...aiSdkReplay(outputOf(second)),
		user("tres"),
	];
	// The carrier follows its message, exactly as the AI SDK stores it.
	assert.equal(input[1]?.role, "assistant");
	assert.equal(input[2]?.type, "reasoning");

	const { body } = geminiBody(input);
	assert.deepEqual(
		body.contents.map((content: Item) => content.role),
		["user", "model", "user", "model", "user"],
	);
	assert.deepEqual(body.contents[1].parts, [
		{ text: "Pensando A", thought: true },
		{ text: "Respuesta A" },
		{ text: "", thoughtSignature: "sig-a" },
	]);
	assert.deepEqual(body.contents[3].parts, [
		{ text: "Respuesta B" },
		{ text: "", thoughtSignature: "sig-b" },
	]);
});

test("message state: anchored by message id before adjacency", () => {
	const [messageA, stateA] = aiSdkReplay(
		outputOf(render(geminiTurn("A", "sig-a"))),
	);
	const [messageB, stateB] = aiSdkReplay(
		outputOf(render(geminiTurn("B", "sig-b"))),
	);
	assert.ok(messageA && stateA && messageB && stateB);
	// Both carriers trail the second message; their ids still pick their own turns.
	const { body } = geminiBody([
		user("uno"),
		messageA,
		user("dos"),
		messageB,
		stateB,
		stateA,
		user("tres"),
	]);
	assert.deepEqual(body.contents[1].parts, [
		{ text: "A" },
		{ text: "", thoughtSignature: "sig-a" },
	]);
	assert.deepEqual(body.contents[3].parts, [
		{ text: "B" },
		{ text: "", thoughtSignature: "sig-b" },
	]);
});

test("message state: clients that drop item ids anchor to the message right before", () => {
	const strip = (items: Item[]) =>
		items.map((item) => {
			const copy = structuredClone(item);
			delete copy.id;
			return copy;
		});
	const first = strip(aiSdkReplay(outputOf(render(geminiTurn("A", "sig-a")))));
	const second = strip(aiSdkReplay(outputOf(render(geminiTurn("B", "sig-b")))));
	const { body } = geminiBody([
		user("uno"),
		...first,
		user("dos"),
		...second,
		user("tres"),
	]);
	assert.equal(body.contents[1].parts[1].thoughtSignature, "sig-a");
	assert.equal(body.contents[3].parts[1].thoughtSignature, "sig-b");
});

test("message state: a carrier with nothing to anchor to is dropped", () => {
	const [, state] = aiSdkReplay(outputOf(render(geminiTurn("A", "sig-a"))));
	assert.ok(state);
	const { codec, discarded } = recordingCodec();
	const { body } = geminiBody([user("uno"), state], codec);
	assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "uno" }] }]);
	assert.deepEqual(discarded, ["unanchored"]);
});

function sealWithForeignKey(payload: unknown): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", randomBytes(32), iv);
	cipher.setAAD(Buffer.from("2:A256GCM:test:reasoning-state"));
	const ct = Buffer.concat([
		cipher.update(JSON.stringify(payload)),
		cipher.final(),
	]);
	const envelope = {
		v: 2,
		alg: "A256GCM",
		kid: "test",
		purpose: "reasoning-state",
		iv: iv.toString("base64"),
		tag: cipher.getAuthTag().toString("base64"),
		ct: ct.toString("base64"),
	};
	return `bfrs_1.${Buffer.from(JSON.stringify(envelope)).toString("base64url")}`;
}

function sealed(payload: unknown): string {
	return `bfrs_1.${Buffer.from(
		JSON.stringify(encryptJson(payload, "reasoning-state")),
	).toString("base64url")}`;
}

test("message state: unusable carriers are dropped and the request goes on", () => {
	const [message, state] = aiSdkReplay(
		outputOf(render(geminiTurn("A", "sig-a"))),
	);
	assert.ok(message && state);
	const valid = String(state.encrypted_content);
	const middle = Math.floor(valid.length / 2);
	const tampered = `${valid.slice(0, middle)}${valid[middle] === "A" ? "B" : "A"}${valid.slice(middle + 1)}`;
	const payload = {
		version: 1,
		provider: "google",
		messageId: message.id,
		state: [{ text: "A" }, { text: "", thoughtSignature: "sig-x" }],
	};
	const cases: [string, MessageStateDiscardReason][] = [
		[tampered, "undecryptable"],
		[sealWithForeignKey(payload), "undecryptable"],
		["bfrs_2.AAAA", "unsupported"],
		[sealed({ ...payload, version: 2 }), "unsupported"],
		[sealed({ ...payload, state: "nope" }), "malformed"],
	];
	for (const [encrypted, reason] of cases) {
		const { codec, discarded } = recordingCodec();
		const { body } = geminiBody(
			[
				user("uno"),
				message,
				{ ...state, encrypted_content: encrypted },
				user("dos"),
			],
			codec,
		);
		assert.deepEqual(body.contents[1].parts, [{ text: "A" }], reason);
		assert.deepEqual(discarded, [reason]);
	}
});

test("message state: an edited message keeps the client's text and loses its signatures", () => {
	const output = outputOf(render(geminiTurn("Original", "sig-a")));
	const [message, state] = aiSdkReplay(output);
	assert.ok(message && state);
	// The edited message also carries the LiteLLM-style mirror of the stale state.
	const edited = {
		...message,
		content: [{ type: "output_text", text: "Editado" }],
		provider_specific_fields: output[0]?.provider_specific_fields,
	};
	const { codec, discarded } = recordingCodec();
	const { body } = geminiBody([user("uno"), edited, state, user("dos")], codec);
	assert.deepEqual(body.contents[1].parts, [{ text: "Editado" }]);
	assert.deepEqual(discarded, ["content_mismatch"]);
});

test("message state: the carrier and the mirror of the same state apply once", () => {
	const raw = {
		candidates: [
			{
				index: 0,
				finishReason: "STOP",
				content: {
					parts: [
						{ text: "Busco." },
						{ text: "", thoughtSignature: "sig-text" },
						{
							functionCall: { id: "call_1", name: "search", args: {} },
							thoughtSignature: "sig-fc",
						},
					],
				},
			},
		],
		usageMetadata: {},
	};
	const output = outputOf(render(raw));
	assert.deepEqual(
		output.map((item) => item.type),
		["message", "reasoning", "function_call"],
	);
	const replay = aiSdkReplay(output);
	const message = {
		...replay[0],
		provider_specific_fields: output[0]?.provider_specific_fields,
	};
	const { body } = geminiBody([
		user("uno"),
		message,
		...replay.slice(1),
		{ type: "function_call_output", call_id: replay[2]?.call_id, output: "{}" },
	]);
	assert.deepEqual(body.contents[1], {
		role: "model",
		parts: [
			{ text: "Busco." },
			{ text: "", thoughtSignature: "sig-text" },
			{
				functionCall: { id: "call_1", name: "search", args: {} },
				thoughtSignature: "sig-fc",
			},
		],
	});
	assert.equal(body.contents[2].parts[0].functionResponse.id, "call_1");
});

test("message state: never reaches an OpenAI upstream", () => {
	const [message, state] = aiSdkReplay(
		outputOf(render(geminiTurn("A", "sig-a"))),
	);
	assert.ok(message && state);
	const input = [user("uno"), message, state, user("dos")];
	const { canonical } = geminiBody(input);
	for (const body of [
		buildResponsesRequestBody(canonical, "gpt-x"),
		buildOpenAIChatBody(canonical, "gpt-x"),
	]) {
		const wire = JSON.stringify(body);
		assert.equal(wire.includes("bfrs_"), false);
		assert.equal(wire.includes("sig-a"), false);
	}
	// Input forwarded verbatim to a native Responses upstream loses the carrier too.
	const native = responsesRequestToCanonical(
		request({
			input: [
				...input,
				{ type: "web_search_call", id: "ws_1", status: "completed" },
			],
			include: INCLUDE,
		}),
		{ messageState: recordingCodec().codec },
	);
	assert.ok(native.responsesTransport?.rawInput);
	assert.equal(
		JSON.stringify(buildResponsesRequestBody(native, "gpt-x")).includes(
			"bfrs_",
		),
		false,
	);
	// Without a codec the carrier is dropped rather than read as OpenAI reasoning.
	const plain = responsesRequestToCanonical(request({ input }));
	assert.equal(JSON.stringify(plain).includes("bfrs_"), false);
});
