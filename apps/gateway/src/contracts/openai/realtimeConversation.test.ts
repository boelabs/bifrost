import type { RealtimeTurn, RealtimeFunctionResult } from "#core/realtime.ts";
import { RealtimeConversationTracker } from "./realtimeConversationTracker.ts";
import { RealtimeClientEventError } from "./realtime.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	applyConversationSessionUpdate,
	parseRealtimeConversationEvent,
	newRealtimeConversationState,
	type RealtimeConversationState,
	renderConversationSession,
	conversationConfigOf,
} from "./realtimeConversation.ts";

test("realtime conversation: parses the GA session.update and merges it over the session", () => {
	const event = parseRealtimeConversationEvent({
		type: "session.update",
		session: {
			type: "realtime",
			instructions: "Be brief.",
			output_modalities: ["audio"],
			audio: {
				input: {
					format: { type: "audio/pcm", rate: 24_000 },
					transcription: { model: "gpt-transcribe", language: "es" },
					turn_detection: { type: "server_vad", silence_duration_ms: 700 },
					noise_reduction: { type: "near_field" },
				},
				output: { format: { type: "audio/pcmu" }, voice: "Kore" },
			},
			tools: [
				{ type: "function", name: "lookup", parameters: { type: "object" } },
				{ type: "google_search" },
			],
			tool_choice: "auto",
			max_output_tokens: 800,
			reasoning: { effort: "low" },
		},
	});
	assert.equal(event.type, "session.update");
	if (event.type !== "session.update") {
		return;
	}
	const state = applyConversationSessionUpdate(
		newRealtimeConversationState("live"),
		event.session,
		null,
	);
	// A partial turn_detection of the same type keeps the defaults it does not mention.
	assert.deepEqual(state.turnDetection, {
		type: "server_vad",
		threshold: 0.5,
		prefix_padding_ms: 300,
		silence_duration_ms: 700,
		idle_timeout_ms: null,
		create_response: true,
		interrupt_response: true,
	});
	assert.deepEqual(conversationConfigOf(state), {
		model: "live",
		instructions: "Be brief.",
		outputModality: "audio",
		voice: "Kore",
		vad: {
			type: "server_vad",
			interruptResponse: true,
			createResponse: true,
			threshold: 0.5,
			prefixPaddingMs: 300,
			silenceDurationMs: 700,
		},
		inputTranscription: { languages: ["es"] },
		tools: [{ name: "lookup", parameters: { type: "object" } }],
		toolChoice: "auto",
		googleSearch: true,
		maxOutputTokens: 800,
		reasoningEffort: "low",
		truncation: "auto",
	});
	const rendered = renderConversationSession(state) as Record<string, any>;
	assert.equal(rendered.object, "realtime.session");
	assert.deepEqual(rendered.audio.output, {
		format: { type: "audio/pcmu" },
		voice: "Kore",
		speed: 1,
	});
});

test("realtime conversation: settings no provider honours are refused in OpenAI's vocabulary", () => {
	const refuse = (session: Record<string, unknown>, param: string) =>
		assert.throws(
			() =>
				conversationConfigOf(
					applyConversationSessionUpdate(
						newRealtimeConversationState("live"),
						{ type: "realtime", ...session } as never,
						null,
					),
				),
			(error: unknown) =>
				error instanceof RealtimeClientEventError && error.param === param,
		);
	refuse({ tools: [{ type: "mcp", server_label: "x" }] }, "session.tools.0");
	refuse({ tool_choice: "required" }, "session.tool_choice");
	refuse({ prompt: { id: "pmpt_1" } }, "session.prompt");
	refuse(
		{ truncation: { type: "retention_ratio", retention_ratio: 0.5 } },
		"session.truncation",
	);
	assert.throws(
		() =>
			applyConversationSessionUpdate(
				newRealtimeConversationState("live"),
				{ type: "realtime", model: "other" },
				"evt_1",
			),
		(error: unknown) =>
			error instanceof RealtimeClientEventError &&
			error.param === "session.model" &&
			error.eventId === "evt_1",
	);
	assert.throws(
		() => parseRealtimeConversationEvent({ type: "scooby.dooby.doo" }),
		(error: unknown) =>
			error instanceof RealtimeClientEventError &&
			error.code === "invalid_value" &&
			error.param === "type",
	);
});

/* ------------------------------------------------------------------ tracker */

interface FakeProvider {
	calls: [string, unknown?][];
}

function tracker(update: Partial<RealtimeConversationState> = {}) {
	let state: RealtimeConversationState = {
		...newRealtimeConversationState("live"),
		transcription: { model: "x" },
		...update,
	};
	const events: Record<string, any>[] = [];
	const provider: FakeProvider = { calls: [] };
	const instance = new RealtimeConversationTracker({
		state: () => state,
		emit: (event) => events.push(event),
	});
	instance.attach({
		appendAudio: (pcm: Buffer) =>
			provider.calls.push(["appendAudio", pcm.byteLength]),
		startActivity: () => provider.calls.push(["startActivity"]),
		endActivity: () => provider.calls.push(["endActivity"]),
		flushAudio: () => provider.calls.push(["flushAudio"]),
		sendTurns: (turns: RealtimeTurn[], complete: boolean) =>
			provider.calls.push(["sendTurns", { turns, complete }]),
		sendFunctionResults: (results: RealtimeFunctionResult[]) =>
			provider.calls.push(["sendFunctionResults", results]),
	});
	const types = () => events.map((event) => event.type);
	return {
		instance,
		events,
		provider,
		types,
		setState: (next: Partial<RealtimeConversationState>) => {
			state = { ...state, ...next };
		},
	};
}

test("realtime conversation tracker: a VAD turn becomes a committed user item and an audio response", () => {
	const { instance, events, types } = tracker();
	instance.appendAudio(Buffer.alloc(3200), null);
	instance.provider({ kind: "speech_started" });
	instance.provider({ kind: "input_transcript", text: "Hola, " });
	instance.provider({ kind: "speech_stopped" });
	instance.provider({ kind: "input_transcript", text: "¿qué tal?" });
	instance.provider({ kind: "output_transcript", text: "Muy bien." });
	instance.provider({ kind: "output_audio", pcm: Buffer.alloc(4800) });
	instance.provider({
		kind: "usage",
		usage: {
			inputTokens: 30,
			outputTokens: 20,
			totalTokens: 50,
			audioTokens: 25,
			outputAudioTokens: 15,
		},
	});
	instance.provider({ kind: "turn_complete" });
	assert.deepEqual(types(), [
		"input_audio_buffer.speech_started",
		"conversation.item.input_audio_transcription.delta",
		"input_audio_buffer.speech_stopped",
		"input_audio_buffer.committed",
		"conversation.item.added",
		"conversation.item.done",
		"conversation.item.input_audio_transcription.delta",
		"response.created",
		"response.output_item.added",
		"conversation.item.added",
		"response.content_part.added",
		"response.output_audio_transcript.delta",
		"response.output_audio.delta",
		"conversation.item.input_audio_transcription.completed",
		"response.output_audio.done",
		"response.output_audio_transcript.done",
		"response.content_part.done",
		"response.output_item.done",
		"conversation.item.done",
		"response.done",
	]);
	const [started, , , committed] = events;
	assert.equal(started?.item_id, committed?.item_id);
	assert.equal(started?.audio_start_ms, 100);
	const completed = events.find(
		(event) =>
			event.type === "conversation.item.input_audio_transcription.completed",
	);
	assert.equal(completed?.transcript, "Hola, ¿qué tal?");
	const audio = events.find(
		(event) => event.type === "response.output_audio.delta",
	);
	assert.equal(Buffer.from(audio?.delta, "base64").byteLength, 4800);
	const done = events.at(-1)?.response;
	assert.equal(done.status, "completed");
	assert.deepEqual(done.output[0].content, [
		{ type: "output_audio", transcript: "Muy bien." },
	]);
	assert.deepEqual(done.usage, {
		total_tokens: 50,
		input_tokens: 30,
		output_tokens: 20,
		input_token_details: {
			cached_tokens: 0,
			text_tokens: 0,
			audio_tokens: 25,
			image_tokens: 0,
		},
		output_token_details: { text_tokens: 0, audio_tokens: 15 },
	});
	assert.equal(instance.completedResponses, 1);
});

test("realtime conversation tracker: barge-in cancels the response with turn_detected", () => {
	const { instance, events } = tracker();
	instance.provider({ kind: "output_audio", pcm: Buffer.alloc(480) });
	instance.provider({ kind: "speech_started" });
	instance.provider({ kind: "interrupted" });
	instance.provider({ kind: "turn_complete" });
	// The interrupting speech is still being transcribed after the cut-off turn ends.
	instance.provider({ kind: "input_transcript", text: "Espera." });
	instance.provider({ kind: "speech_stopped" });
	instance.provider({ kind: "output_transcript", text: "Dime." });
	instance.provider({ kind: "turn_complete" });
	assert.equal(
		events.find(
			(event) =>
				event.type === "conversation.item.input_audio_transcription.completed",
		)?.transcript,
		"Espera.",
	);
	const done = events.filter((event) => event.type === "response.done");
	assert.equal(done.length, 2);
	assert.equal(done[0]?.response.status, "cancelled");
	assert.deepEqual(done[0]?.response.status_details, {
		type: "cancelled",
		reason: "turn_detected",
	});
	assert.equal(done[0]?.response.output[0].status, "incomplete");
});

test("realtime conversation tracker: a function call round trip", () => {
	const { instance, events, provider } = tracker();
	instance.provider({
		kind: "function_calls",
		calls: [{ id: "fc_1", name: "lookup", arguments: '{"id":"7"}' }],
	});
	const types = events.map((event) => event.type);
	assert.deepEqual(types, [
		"response.created",
		"response.output_item.added",
		"conversation.item.added",
		"response.function_call_arguments.delta",
		"response.function_call_arguments.done",
		"response.output_item.done",
		"conversation.item.done",
		"response.done",
	]);
	assert.equal(events[4]?.call_id, "fc_1");
	assert.equal(events[4]?.arguments, '{"id":"7"}');
	// An output for an unknown call is refused.
	assert.throws(
		() =>
			instance.createItem(
				{ type: "function_call_output", call_id: "nope", output: "x" },
				undefined,
				null,
			),
		RealtimeClientEventError,
	);
	instance.createItem(
		{ type: "function_call_output", call_id: "fc_1", output: '{"ok":true}' },
		undefined,
		null,
	);
	assert.deepEqual(provider.calls, []);
	instance.createResponse(undefined, null);
	assert.deepEqual(provider.calls, [
		[
			"sendFunctionResults",
			[{ id: "fc_1", name: "lookup", output: '{"ok":true}' }],
		],
	]);
	assert.equal(events.at(-1)?.type, "response.created");
	// Only one response at a time.
	assert.throws(
		() => instance.createResponse(undefined, "evt_2"),
		(error: unknown) =>
			error instanceof RealtimeClientEventError &&
			error.code === "conversation_already_has_active_response",
	);
});

test("realtime conversation tracker: manual turns buffer audio until commit and answer on response.create", () => {
	const { instance, events, provider } = tracker({ turnDetection: null });
	assert.throws(
		() => instance.commit("evt_1"),
		(error: unknown) =>
			error instanceof RealtimeClientEventError &&
			error.code === "input_audio_buffer_commit_empty",
	);
	instance.appendAudio(Buffer.alloc(640), null);
	instance.clear();
	instance.appendAudio(Buffer.alloc(320), null);
	assert.deepEqual(provider.calls, []);
	instance.commit(null);
	assert.deepEqual(provider.calls, [["startActivity"], ["appendAudio", 320]]);
	assert.deepEqual(
		events.map((event) => event.type),
		[
			"input_audio_buffer.cleared",
			"input_audio_buffer.committed",
			"conversation.item.added",
			"conversation.item.done",
		],
	);
	instance.createResponse({ metadata: { turn: "1" } }, null);
	assert.deepEqual(provider.calls.at(-1), ["endActivity"]);
	assert.deepEqual(events.at(-1)?.response.metadata, { turn: "1" });
});

test("realtime conversation tracker: text items, text sessions and cancellation", () => {
	const { instance, events, provider } = tracker({ outputModality: "text" });
	instance.createItem(
		{
			type: "message",
			role: "user",
			content: [
				{ type: "input_text", text: "Describe esto" },
				{ type: "input_image", image_url: "data:image/png;base64,iVBO" },
			],
		},
		undefined,
		null,
	);
	assert.deepEqual(provider.calls[0], [
		"sendTurns",
		{
			turns: [
				{
					role: "user",
					parts: [
						{ type: "text", text: "Describe esto" },
						{ type: "image", mimeType: "image/png", data: "iVBO" },
					],
				},
			],
			complete: false,
		},
	]);
	assert.throws(
		() =>
			instance.createItem(
				{
					type: "message",
					role: "system",
					content: [{ type: "input_text", text: "x" }],
				},
				undefined,
				null,
			),
		RealtimeClientEventError,
	);
	assert.throws(
		() =>
			instance.createItem(
				{
					type: "message",
					role: "user",
					content: [{ type: "input_text", text: "x" }],
				},
				"item_elsewhere",
				null,
			),
		RealtimeClientEventError,
	);
	instance.createResponse(undefined, null);
	assert.deepEqual(provider.calls.at(-1), [
		"sendTurns",
		{ turns: [], complete: true },
	]);
	// A text session reads the transcript of the spoken reply; its audio is dropped.
	instance.provider({ kind: "output_audio", pcm: Buffer.alloc(480) });
	instance.provider({ kind: "output_transcript", text: "Un gato." });
	assert.ok(
		!events.some((event) => event.type === "response.output_audio.delta"),
	);
	assert.equal(
		events.find((event) => event.type === "response.output_text.delta")?.delta,
		"Un gato.",
	);
	instance.cancelResponse(undefined, null);
	const done = events.at(-1);
	assert.equal(done?.type, "response.done");
	assert.deepEqual(done?.response.status_details, {
		type: "cancelled",
		reason: "client_cancelled",
	});
	// The rest of the cancelled turn is dropped.
	instance.provider({ kind: "output_transcript", text: " Negro." });
	instance.provider({ kind: "turn_complete" });
	assert.equal(events.at(-1), done);
	assert.throws(
		() => instance.cancelResponse(undefined, null),
		RealtimeClientEventError,
	);
});

test("realtime conversation tracker: content ends at generation_complete, response.done waits for the turn's usage", () => {
	const { instance, events } = tracker();
	instance.provider({ kind: "output_transcript", text: "Listo." });
	instance.provider({ kind: "output_audio", pcm: Buffer.alloc(480) });
	instance.provider({ kind: "generation_complete" });
	assert.equal(events.at(-1)?.type, "conversation.item.done");
	instance.provider({
		kind: "usage",
		usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
	});
	instance.provider({ kind: "turn_complete" });
	const done = events.at(-1);
	assert.equal(done?.type, "response.done");
	assert.equal(done?.response.status, "completed");
	assert.equal(done?.response.usage.total_tokens, 15);

	// A client that does not wait for the turn to end is not blocked by it.
	instance.provider({ kind: "output_transcript", text: "Otra." });
	instance.provider({ kind: "generation_complete" });
	instance.createResponse(undefined, null);
	const types = events.map((event) => event.type);
	assert.deepEqual(types.slice(-2), ["response.done", "response.created"]);
	assert.equal(events.at(-2)?.response.usage, null);
});

test("realtime conversation tracker: without voice activity events, transcripts open the user's items", () => {
	const { instance, types, events } = tracker();
	instance.provider({ kind: "input_transcript", text: "Hola," });
	instance.provider({ kind: "output_transcript", text: "Hello," });
	instance.provider({ kind: "input_transcript", text: " mundo." });
	instance.provider({ kind: "turn_complete" });
	assert.deepEqual(types().slice(0, 6), [
		"input_audio_buffer.speech_started",
		"conversation.item.input_audio_transcription.delta",
		"input_audio_buffer.speech_stopped",
		"input_audio_buffer.committed",
		"conversation.item.added",
		"conversation.item.done",
	]);
	assert.equal(
		events.find(
			(event) =>
				event.type === "conversation.item.input_audio_transcription.completed",
		)?.transcript,
		"Hola, mundo.",
	);
});
