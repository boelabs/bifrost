import { RealtimeTranscriptTracker } from "./realtimeTranscript.ts";
import type { RealtimeTurnDetection } from "#core/realtime.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	RealtimeClientEventError,
	parseRealtimeClientEvent,
	newRealtimeSessionState,
	applySessionUpdate,
	realtimeConfigOf,
	INTERIM_INCLUDE,
	renderSession,
} from "./realtime.ts";

test("realtime: parses the GA transcription session.update", () => {
	const event = parseRealtimeClientEvent({
		type: "session.update",
		event_id: "evt_1",
		session: {
			type: "transcription",
			audio: {
				input: {
					format: { type: "audio/pcm", rate: 24_000 },
					transcription: {
						model: "transcribe-live",
						languages: ["es-419"],
						keywords: ["Bifrozz"],
						transcription_mode: "smart",
						prompt: "ignored by Gemini",
					},
					turn_detection: null,
					noise_reduction: { type: "near_field" },
				},
			},
			include: [INTERIM_INCLUDE],
		},
	});
	assert.equal(event.type, "session.update");
	assert.equal(event.event_id, "evt_1");
});

test("realtime: invalid events are reported in OpenAI's vocabulary", () => {
	const reject = (raw: unknown, code: string, param: string | null) =>
		assert.throws(
			() => parseRealtimeClientEvent(raw),
			(error: unknown) =>
				error instanceof RealtimeClientEventError &&
				error.code === code &&
				error.param === param,
		);
	reject({ audio: "AAAA" }, "invalid_event", "type");
	reject({ type: "response.create" }, "invalid_event", "type");
	reject({ type: "input_audio_buffer.append" }, "invalid_value", "audio");
	reject(
		{
			type: "session.update",
			session: {
				type: "transcription",
				audio: { input: { transcription: { keywords: ["a<b"] } } },
			},
		},
		"invalid_value",
		"session.audio.input.transcription.keywords.0",
	);
	reject(
		{
			type: "session.update",
			session: {
				type: "transcription",
				audio: { input: { format: { type: "audio/pcm", rate: 44_100 } } },
			},
		},
		"invalid_value",
		"session.audio.input.format.rate",
	);
	reject(
		{
			type: "session.update",
			session: {
				type: "transcription",
				audio: {
					input: { transcription: { language: "es", languages: ["en"] } },
				},
			},
		},
		"invalid_value",
		"session.audio.input.transcription.languages",
	);
});

test("realtime: session.update merges over the current session and keeps the model", () => {
	let state = newRealtimeSessionState();
	assert.equal(realtimeConfigOf(state), null);
	assert.equal(state.turnDetection?.type, "server_vad");
	state = applySessionUpdate(state, {
		type: "transcription",
		audio: {
			input: {
				transcription: { model: "transcribe-live", language: "es-US" },
			},
		},
	});
	assert.deepEqual(realtimeConfigOf(state), {
		model: "transcribe-live",
		turnDetection: "server_vad",
		language: "es-US",
	});
	state = applySessionUpdate(state, {
		type: "transcription",
		audio: {
			input: {
				transcription: { keywords: ["AC-42"] },
				turn_detection: null,
				format: { type: "audio/pcmu" },
			},
		},
	});
	assert.deepEqual(realtimeConfigOf(state), {
		model: "transcribe-live",
		turnDetection: "manual",
		keywords: ["AC-42"],
	});
	const rendered = renderSession(state) as Record<string, any>;
	assert.equal(rendered.object, "realtime.transcription_session");
	assert.equal(rendered.type, "transcription");
	assert.deepEqual(rendered.audio.input.format, { type: "audio/pcmu" });
	assert.equal(rendered.audio.input.turn_detection, null);
	assert.match(rendered.id, /^sess_/);
});

/* ------------------------------------------------------------------ tracker */

function tracker(
	turnDetection: RealtimeTurnDetection,
	options: { interim?: boolean; graceMs?: number } = {},
) {
	const events: Record<string, any>[] = [];
	const instance = new RealtimeTranscriptTracker({
		turnDetection,
		previousItemId: "item_prev",
		includeInterim: () => options.interim ?? false,
		audioMs: () => 1500,
		emit: (event) => events.push(event),
		commitGraceMs: options.graceMs ?? 10_000,
	});
	const types = () => events.map((event) => event.type);
	return { instance, events, types };
}

test("realtime tracker: manual turns commit an item and complete it with the final", () => {
	const { instance, events, types } = tracker("manual");
	assert.equal(instance.beforeAudio(), true);
	assert.equal(instance.beforeAudio(), false);
	// An interim's last word is still being revised, so deltas stop before it.
	instance.provider({ kind: "interim", text: "hola" });
	instance.provider({ kind: "interim", text: "hola mun" });
	instance.provider({ kind: "interim", text: "hola mundo cru" });
	// A revision that does not extend the sent text is withheld.
	instance.provider({ kind: "interim", text: "ola mundo cruel" });
	instance.commit(null);
	instance.provider({ kind: "final", text: "hola mundo cruel." });
	assert.deepEqual(types(), [
		"conversation.item.input_audio_transcription.delta",
		"conversation.item.input_audio_transcription.delta",
		"input_audio_buffer.committed",
		"conversation.item.added",
		"conversation.item.input_audio_transcription.delta",
		"conversation.item.input_audio_transcription.completed",
	]);
	const [first, second, committed, added, last, completed] = events;
	assert.equal(first?.delta, "hola");
	assert.equal(second?.delta, " mundo");
	assert.equal(committed?.previous_item_id, "item_prev");
	assert.equal(added?.item.role, "user");
	assert.equal(last?.delta, " cruel.");
	assert.equal(completed?.transcript, "hola mundo cruel.");
	assert.equal(completed?.item_id, committed?.item_id);
	assert.equal(completed?.content_index, 0);
	assert.equal(instance.completedItems, 1);
	assert.equal(instance.lastItemId, committed?.item_id);
});

test("realtime tracker: deltas add up to the transcript whenever the final extends them", () => {
	const { instance, events } = tracker("manual");
	instance.beforeAudio();
	instance.provider({ kind: "interim", text: "Good" });
	instance.commit(null);
	instance.provider({
		kind: "usage",
		usage: {
			inputTokens: 25,
			outputTokens: 2,
			totalTokens: 27,
			audioTokens: 25,
		},
	});
	instance.provider({ kind: "final", text: "Good morning." });
	const deltas = events
		.filter((event) => event.type.endsWith(".delta"))
		.map((event) => event.delta)
		.join("");
	const completed = events.at(-1);
	assert.equal(deltas, "Good morning.");
	assert.equal(completed?.transcript, "Good morning.");
	assert.deepEqual(completed?.usage, {
		type: "tokens",
		input_tokens: 25,
		input_token_details: { audio_tokens: 25 },
		output_tokens: 2,
		total_tokens: 27,
	});
});

test("realtime tracker: committing an empty buffer is OpenAI's commit_empty error", () => {
	const { instance } = tracker("manual");
	assert.throws(
		() => instance.commit("evt_9"),
		(error: unknown) =>
			error instanceof RealtimeClientEventError &&
			error.code === "input_audio_buffer_commit_empty" &&
			error.eventId === "evt_9",
	);
});

test("realtime tracker: a committed item without a final completes after the grace period", async () => {
	const { instance, events } = tracker("manual", { graceMs: 10 });
	instance.beforeAudio();
	instance.provider({ kind: "interim", text: "partial" });
	instance.commit(null);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(
		events.at(-1)?.type,
		"conversation.item.input_audio_transcription.completed",
	);
	assert.equal(events.at(-1)?.transcript, "");
	// A late final for it changes nothing.
	instance.provider({ kind: "final", text: "partial words" });
	assert.equal(instance.completedItems, 1);
});

test("realtime tracker: clear drops the open utterance's transcript", () => {
	const { instance, types } = tracker("manual");
	instance.beforeAudio();
	assert.equal(instance.clear(), true);
	instance.provider({ kind: "final", text: "discarded" });
	assert.deepEqual(types(), []);
	assert.equal(instance.clear(), false);
	assert.equal(instance.beforeAudio(), true);
});

test("realtime tracker: server VAD frames each final as a committed utterance", () => {
	const { instance, events, types } = tracker("server_vad", { interim: true });
	assert.equal(instance.beforeAudio(), false);
	instance.commit(null);
	instance.provider({ kind: "interim", text: "uno" });
	instance.provider({ kind: "final", text: "Uno, dos." });
	instance.provider({ kind: "final", text: "Tres." });
	assert.deepEqual(types(), [
		"input_audio_buffer.speech_started",
		"conversation.item.input_audio_transcription.interim",
		"input_audio_buffer.speech_stopped",
		"input_audio_buffer.committed",
		"conversation.item.added",
		"conversation.item.input_audio_transcription.interim",
		"conversation.item.input_audio_transcription.delta",
		"conversation.item.input_audio_transcription.completed",
		"input_audio_buffer.speech_started",
		"input_audio_buffer.speech_stopped",
		"input_audio_buffer.committed",
		"conversation.item.added",
		"conversation.item.input_audio_transcription.interim",
		"conversation.item.input_audio_transcription.delta",
		"conversation.item.input_audio_transcription.completed",
	]);
	const completed = events.filter((event) => event.type.endsWith(".completed"));
	assert.deepEqual(
		completed.map((event) => event.transcript),
		["Uno, dos.", "Tres."],
	);
	assert.equal(events[0]?.audio_start_ms, 1500);
	const committed = events.filter(
		(event) => event.type === "input_audio_buffer.committed",
	);
	assert.equal(committed[1]?.previous_item_id, committed[0]?.item_id);
});
