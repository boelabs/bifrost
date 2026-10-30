import type { RealtimeConversationSession } from "#adapters/types.ts";

import {
	type AudioOutputEncoder,
	createAudioOutputEncoder,
	createAudioInputDecoder,
} from "#audio/pcm.ts";

import {
	type CanonicalRealtimeConversationEvent,
	type RealtimeFunctionCall,
	type RealtimeFunctionResult,
	REALTIME_OUTPUT_SAMPLE_RATE,
	REALTIME_AUDIO_SAMPLE_RATE,
	type RealtimeContentPart,
	addRealtimeUsage,
	type RealtimeUsage,
	type RealtimeTurn,
} from "#core/realtime.ts";

import {
	type RealtimeConversationState,
	type RealtimeConversationItem,
	type RealtimeResponseParams,
	renderResponseUsage,
	conversationEvent,
	responseId,
} from "./realtimeConversation.ts";

import { RealtimeClientEventError, itemId } from "./realtime.ts";

/**
 * The OpenAI side of a realtime conversation: the item list, the input audio buffer and the response
 * lifecycle, kept in OpenAI's terms while the provider speaks its own protocol.
 *
 * The provider owns the conversation's context; the tracker keeps what OpenAI's events need (ids,
 * order, transcripts) and decides when the provider is asked to answer: when voice activity ends a
 * turn (the provider answers on its own), or on `response.create` (manual turns, client items,
 * function results).
 */

export type ConversationProvider = Pick<
	RealtimeConversationSession,
	| "appendAudio"
	| "startActivity"
	| "endActivity"
	| "flushAudio"
	| "sendTurns"
	| "sendFunctionResults"
>;

export interface RealtimeConversationTrackerOptions {
	state: () => RealtimeConversationState;
	emit: (event: Record<string, unknown>) => void;
}

/** Manual turns keep at most this much unsent audio (about 10 minutes at 16 kHz). */
const MAX_BUFFERED_BYTES = 10 * 60 * REALTIME_AUDIO_SAMPLE_RATE * 2;

interface UserAudioItem {
	id: string;
	transcript: string;
	/** The transcript was completed (no more deltas are sent for it). */
	done: boolean;
}

interface MessageOutput {
	item: Record<string, unknown>;
	outputIndex: number;
	transcript: string;
	text: string;
}

interface ActiveResponse {
	id: string;
	output: Record<string, unknown>[];
	message: MessageOutput | null;
	usage: RealtimeUsage | null;
	metadata: Record<string, string> | null;
	/**
	 * The provider finished generating. Its turn may not be over yet (Gemini holds `turnComplete`,
	 * and the usage that comes with it, for as long as playing the reply would take), so
	 * `response.done` waits for that, or for whatever the client does next.
	 */
	generated: boolean;
}

function clientError(
	message: string,
	code: string,
	param: string | null,
	clientEventId: string | null,
): RealtimeClientEventError {
	return new RealtimeClientEventError(message, code, param, clientEventId);
}

function dataUrlImage(
	url: string,
	clientEventId: string | null,
): { mimeType: string; data: string } {
	const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/s.exec(url);
	if (!(match?.[1] && match[2])) {
		throw clientError(
			"input_image.image_url must be a base64 data URL (PNG, JPEG or WebP).",
			"invalid_value",
			"item.content.image_url",
			clientEventId,
		);
	}
	return {
		mimeType: match[1] === "image/jpg" ? "image/jpeg" : match[1],
		data: match[2],
	};
}

export class RealtimeConversationTracker {
	private readonly options: RealtimeConversationTrackerOptions;
	private session: ConversationProvider | null = null;
	private readonly items = new Map<string, Record<string, unknown>>();
	lastItemId: string | null = null;
	private buffered: Buffer[] = [];
	private bufferedBytes = 0;
	/** Manual turns: committed audio the provider has not been asked to answer yet. */
	private activityOpen = false;
	/** Client items sent since the last answer, waiting for `response.create`. */
	private contentPending = false;
	private pendingResults: RealtimeFunctionResult[] = [];
	/** Function calls the model made, by call id, until their output arrives. */
	private readonly calls = new Map<string, string>();
	private userItem: UserAudioItem | null = null;
	/** The provider reports voice activity; without it, transcripts open the user's items. */
	private hearsActivity = false;
	private response: ActiveResponse | null = null;
	/** After `response.cancel`, the provider's remaining output for that turn is dropped. */
	private suppressing = false;
	private nextMetadata: Record<string, string> | null = null;
	private encoder: AudioOutputEncoder;
	private encoderFormat: string;
	firstOutputAt: number | null = null;
	completedResponses = 0;
	/** Totals for estimating usage when the provider reports none. */
	inputAudioSeconds = 0;
	outputAudioSeconds = 0;
	inputTextCharacters = 0;
	outputTextCharacters = 0;
	/** Provider-reported usage across the session. */
	usage: RealtimeUsage | null = null;

	constructor(options: RealtimeConversationTrackerOptions) {
		this.options = options;
		const format = options.state().outputFormat;
		this.encoder = createAudioOutputEncoder(format);
		this.encoderFormat = JSON.stringify(format);
	}

	attach(provider: ConversationProvider): void {
		this.session = provider;
	}

	private get state(): RealtimeConversationState {
		return this.options.state();
	}

	private get manual(): boolean {
		return this.state.turnDetection === null;
	}

	private send(): ConversationProvider {
		if (!this.session) {
			throw new Error("realtime conversation used before its provider session");
		}
		return this.session;
	}

	private emit(type: string, fields: Record<string, unknown>): void {
		this.options.emit(conversationEvent(type, fields));
	}

	private addItem(item: Record<string, unknown>): string | null {
		const previous = this.lastItemId;
		const id = String(item.id);
		this.items.set(id, item);
		this.lastItemId = id;
		return previous;
	}

	/* ---------------------------------------------------------------- client events */

	/** 16 kHz PCM16 from the client. */
	appendAudio(pcm: Buffer, clientEventId: string | null): void {
		this.inputAudioSeconds += pcm.byteLength / 2 / REALTIME_AUDIO_SAMPLE_RATE;
		if (!this.manual) {
			this.send().appendAudio(pcm);
			return;
		}
		if (this.bufferedBytes + pcm.byteLength > MAX_BUFFERED_BYTES) {
			throw clientError(
				"The input audio buffer is full; commit or clear it.",
				"input_audio_buffer_full",
				null,
				clientEventId,
			);
		}
		this.buffered.push(pcm);
		this.bufferedBytes += pcm.byteLength;
	}

	commit(clientEventId: string | null): void {
		if (!this.manual) {
			// Server VAD: the provider decides where the turn ends; flushing just finalizes it now.
			this.send().flushAudio();
			return;
		}
		if (this.bufferedBytes === 0) {
			throw clientError(
				"Error committing input audio buffer: the buffer is empty.",
				"input_audio_buffer_commit_empty",
				null,
				clientEventId,
			);
		}
		const provider = this.send();
		if (!this.activityOpen) {
			provider.startActivity();
			this.activityOpen = true;
		}
		provider.appendAudio(Buffer.concat(this.buffered));
		this.buffered = [];
		this.bufferedBytes = 0;
		this.finishUserTranscript();
		const item = this.userAudioItem();
		const previous = this.addItem(item);
		this.userItem = { id: String(item.id), transcript: "", done: false };
		this.emit("input_audio_buffer.committed", {
			previous_item_id: previous,
			item_id: item.id,
		});
		this.emit("conversation.item.added", { previous_item_id: previous, item });
		this.emit("conversation.item.done", { previous_item_id: previous, item });
	}

	clear(): void {
		this.buffered = [];
		this.bufferedBytes = 0;
		this.emit("input_audio_buffer.cleared", {});
	}

	createItem(
		item: RealtimeConversationItem,
		previousItemId: string | null | undefined,
		clientEventId: string | null,
	): void {
		if (
			previousItemId !== undefined &&
			previousItemId !== null &&
			previousItemId !== this.lastItemId
		) {
			throw clientError(
				"Items can only be appended to the end of the conversation.",
				"unsupported_parameter",
				"previous_item_id",
				clientEventId,
			);
		}
		const id = item.id ?? itemId();
		if (this.items.has(id)) {
			throw clientError(
				`Item with id '${id}' already exists.`,
				"invalid_value",
				"item.id",
				clientEventId,
			);
		}
		const provider = this.send();
		let stored: Record<string, unknown>;
		if (item.type === "function_call_output") {
			const name = this.calls.get(item.call_id);
			if (name === undefined) {
				throw clientError(
					`No function call with call_id '${item.call_id}' is waiting for output.`,
					"invalid_value",
					"item.call_id",
					clientEventId,
				);
			}
			this.calls.delete(item.call_id);
			this.pendingResults.push({ id: item.call_id, name, output: item.output });
			this.inputTextCharacters += item.output.length;
			stored = {
				id,
				object: "realtime.item",
				type: "function_call_output",
				status: "completed",
				call_id: item.call_id,
				output: item.output,
			};
		} else if (item.type === "function_call") {
			throw clientError(
				"Function call items can only come from the model.",
				"unsupported_parameter",
				"item.type",
				clientEventId,
			);
		} else {
			if (item.role === "system") {
				throw clientError(
					"System messages are not supported mid-conversation; set session.instructions instead.",
					"unsupported_parameter",
					"item.role",
					clientEventId,
				);
			}
			const parts: RealtimeContentPart[] = [];
			for (const part of item.content) {
				if (part.type === "input_text" || part.type === "output_text") {
					parts.push({ type: "text", text: part.text });
					this.inputTextCharacters += part.text.length;
				} else if (part.type === "output_audio") {
					parts.push({ type: "text", text: part.transcript });
					this.inputTextCharacters += part.transcript.length;
				} else if (part.type === "input_image") {
					parts.push({
						type: "image",
						...dataUrlImage(part.image_url, clientEventId),
					});
				} else {
					const pcm = createAudioInputDecoder(this.state.inputFormat).push(
						Buffer.from(part.audio, "base64"),
					);
					this.inputAudioSeconds +=
						pcm.byteLength / 2 / REALTIME_AUDIO_SAMPLE_RATE;
					parts.push({ type: "audio", pcm });
				}
			}
			const turn: RealtimeTurn = {
				role: item.role === "assistant" ? "model" : "user",
				parts,
			};
			provider.sendTurns([turn], false);
			this.contentPending = true;
			stored = {
				id,
				object: "realtime.item",
				type: "message",
				status: "completed",
				role: item.role,
				content: item.content.map((part) =>
					part.type === "input_audio"
						? { type: "input_audio", transcript: part.transcript ?? null }
						: part,
				),
			};
		}
		const previous = this.addItem(stored);
		this.emit("conversation.item.added", {
			previous_item_id: previous,
			item: stored,
		});
		this.emit("conversation.item.done", {
			previous_item_id: previous,
			item: stored,
		});
	}

	retrieve(id: string, clientEventId: string | null): void {
		const item = this.items.get(id);
		if (!item) {
			throw clientError(
				`Item with item_id '${id}' not found.`,
				"item_not_found",
				"item_id",
				clientEventId,
			);
		}
		this.emit("conversation.item.retrieved", { item });
	}

	/**
	 * The client stopped playing an assistant reply at `audioEndMs`. The provider keeps its own
	 * record of what it said, so only the acknowledgement changes here.
	 */
	truncate(
		id: string,
		contentIndex: number,
		audioEndMs: number,
		clientEventId: string | null,
	): void {
		const item = this.items.get(id);
		if (item?.role !== "assistant") {
			throw clientError(
				`Assistant item with item_id '${id}' not found.`,
				"item_not_found",
				"item_id",
				clientEventId,
			);
		}
		this.emit("conversation.item.truncated", {
			item_id: id,
			content_index: contentIndex,
			audio_end_ms: audioEndMs,
		});
	}

	delete(_id: string, clientEventId: string | null): never {
		throw clientError(
			"This model cannot remove items from a conversation it has already heard.",
			"unsupported_parameter",
			"item_id",
			clientEventId,
		);
	}

	/** Asks the provider to answer what it has: committed audio, client items, function results. */
	createResponse(
		params: RealtimeResponseParams | undefined,
		clientEventId: string | null,
	): void {
		this.settleGenerated();
		if (this.response) {
			throw clientError(
				`Conversation already has an active response in progress: ${this.response.id}. Wait until the response is finished before creating a new one.`,
				"conversation_already_has_active_response",
				null,
				clientEventId,
			);
		}
		this.assertResponseParams(params, clientEventId);
		const provider = this.send();
		this.nextMetadata = params?.metadata ?? null;
		if (this.pendingResults.length > 0) {
			provider.sendFunctionResults(this.pendingResults);
			this.pendingResults = [];
			this.contentPending = false;
		} else if (this.activityOpen) {
			this.activityOpen = false;
			provider.endActivity();
			this.contentPending = false;
		} else if (params?.instructions) {
			// Gemini has no per-response instructions: they reach the model as a user turn.
			provider.sendTurns(
				[
					{
						role: "user",
						parts: [{ type: "text", text: params.instructions }],
					},
				],
				true,
			);
			this.inputTextCharacters += params.instructions.length;
			this.contentPending = false;
		} else {
			provider.sendTurns([], true);
			this.contentPending = false;
		}
		this.startResponse();
	}

	private assertResponseParams(
		params: RealtimeResponseParams | undefined,
		clientEventId: string | null,
	): void {
		if (!params) {
			return;
		}
		const reject = (param: string, message: string): never => {
			throw clientError(
				message,
				"unsupported_parameter",
				`response.${param}`,
				clientEventId,
			);
		};
		const { state } = this;
		if (params.conversation === "none" || params.input !== undefined) {
			reject(
				params.input === undefined ? "conversation" : "input",
				"Out-of-band responses are not supported; responses always use the session's conversation.",
			);
		}
		if (params.tools !== undefined || params.tool_choice !== undefined) {
			reject(
				params.tools === undefined ? "tool_choice" : "tools",
				"Per-response tools are not supported; set them with session.update.",
			);
		}
		if (
			params.output_modalities !== undefined &&
			params.output_modalities[0] !== state.outputModality
		) {
			reject(
				"output_modalities",
				"Per-response output_modalities are not supported; set them with session.update.",
			);
		}
		const voice = params.audio?.output?.voice;
		if (voice !== undefined && voice !== state.voice) {
			reject(
				"audio.output.voice",
				"Per-response voices are not supported; set the voice with session.update.",
			);
		}
		if (
			params.audio?.output?.format !== undefined &&
			JSON.stringify(params.audio.output.format) !==
				JSON.stringify(state.outputFormat)
		) {
			reject(
				"audio.output.format",
				"Per-response audio formats are not supported; set the format with session.update.",
			);
		}
		if (
			params.max_output_tokens !== undefined &&
			params.max_output_tokens !== state.maxOutputTokens
		) {
			reject(
				"max_output_tokens",
				"Per-response max_output_tokens is not supported; set it with session.update.",
			);
		}
		if (params.reasoning !== undefined || params.prompt !== undefined) {
			reject(
				params.prompt === undefined ? "reasoning" : "prompt",
				"Per-response reasoning and prompts are not supported; set them with session.update.",
			);
		}
	}

	cancelResponse(
		responseIdValue: string | undefined,
		clientEventId: string | null,
	): void {
		const { response } = this;
		if (!response || (responseIdValue && responseIdValue !== response.id)) {
			throw clientError(
				"Cancellation failed: no active response found.",
				"response_cancel_not_active",
				null,
				clientEventId,
			);
		}
		this.suppressing = true;
		this.finishResponse("cancelled", "client_cancelled");
	}

	/* ---------------------------------------------------------------- provider events */

	provider(event: CanonicalRealtimeConversationEvent): void {
		switch (event.kind) {
			case "speech_started":
				this.hearsActivity = true;
				this.speechStarted();
				return;
			case "speech_stopped":
				this.hearsActivity = true;
				this.speechStopped();
				return;
			case "input_transcript_interim":
				return;
			case "input_transcript":
				this.inputTranscript(event.text);
				return;
			case "usage":
				this.usage = addRealtimeUsage(this.usage, event.usage);
				if (this.response) {
					this.response.usage = addRealtimeUsage(
						this.response.usage,
						event.usage,
					);
				}
				return;
			case "function_calls_cancelled":
				for (const id of event.ids) {
					this.calls.delete(id);
				}
				return;
			case "interrupted":
				this.suppressing = false;
				if (this.response?.generated) {
					// Cut off while "playing": the reply itself was complete.
					this.finishResponse("completed", null);
				} else if (this.response) {
					this.finishResponse("cancelled", "turn_detected");
				}
				return;
			case "generation_complete":
				this.finishUserTranscript(true);
				if (this.suppressing) {
					this.suppressing = false;
					return;
				}
				if (this.response && !this.response.generated) {
					this.closeMessage(this.response, "completed");
					this.response.generated = true;
				}
				return;
			case "turn_complete":
				this.finishUserTranscript(true);
				if (this.suppressing) {
					this.suppressing = false;
					return;
				}
				if (this.response) {
					this.finishResponse("completed", null);
				}
				return;
			default:
				break;
		}
		if (this.suppressing) {
			return;
		}
		switch (event.kind) {
			case "output_audio":
				this.outputAudio(event.pcm);
				return;
			case "output_text":
			case "output_transcript":
				this.outputText(event.kind, event.text);
				return;
			case "function_calls":
				this.functionCalls(event.calls);
				return;
			default:
				return;
		}
	}

	/** The session is ending: close whatever is open. */
	finish(): void {
		this.finishUserTranscript();
		if (this.response) {
			this.finishResponse(
				this.response.generated ? "completed" : "incomplete",
				null,
			);
		}
	}

	/** A generated response still waiting for its turn to end is done once anything else happens. */
	private settleGenerated(): void {
		if (this.response?.generated) {
			this.finishResponse("completed", null);
		}
	}

	private userAudioItem(): Record<string, unknown> {
		return {
			id: itemId(),
			object: "realtime.item",
			type: "message",
			status: "completed",
			role: "user",
			content: [{ type: "input_audio", transcript: null }],
		};
	}

	private audioMs(): number {
		return Math.round(this.inputAudioSeconds * 1000);
	}

	private speechStarted(): void {
		if (this.manual) {
			return;
		}
		this.settleGenerated();
		this.finishUserTranscript();
		const id = itemId();
		this.userItem = { id, transcript: "", done: false };
		this.emit("input_audio_buffer.speech_started", {
			audio_start_ms: this.audioMs(),
			item_id: id,
		});
	}

	private speechStopped(): void {
		if (this.manual || !this.userItem || this.items.has(this.userItem.id)) {
			return;
		}
		const { id } = this.userItem;
		this.emit("input_audio_buffer.speech_stopped", {
			audio_end_ms: this.audioMs(),
			item_id: id,
		});
		const item = { ...this.userAudioItem(), id };
		const previous = this.addItem(item);
		this.emit("input_audio_buffer.committed", {
			previous_item_id: previous,
			item_id: id,
		});
		this.emit("conversation.item.added", { previous_item_id: previous, item });
		this.emit("conversation.item.done", { previous_item_id: previous, item });
	}

	private inputTranscript(text: string): void {
		if (
			!(this.manual || this.hearsActivity) &&
			(!this.userItem || this.userItem.done)
		) {
			// No voice activity events (translation streams): the transcript marks the speech.
			this.speechStarted();
		}
		const item = this.userItem;
		if (!item || item.done || this.state.transcription === null) {
			return;
		}
		item.transcript += text;
		this.emit("conversation.item.input_audio_transcription.delta", {
			item_id: item.id,
			content_index: 0,
			delta: text,
		});
	}

	/**
	 * Completes the user's transcript. `answered`: the model's turn ended, which only settles speech
	 * it answered (a committed item); speech that interrupted it is still being transcribed.
	 */
	private finishUserTranscript(answered = false): void {
		const item = this.userItem;
		if (!item || item.done || (answered && !this.items.has(item.id))) {
			return;
		}
		item.done = true;
		if (this.state.transcription === null || !this.items.has(item.id)) {
			return;
		}
		const transcript = item.transcript.trim();
		const stored = this.items.get(item.id);
		if (stored) {
			stored.content = [{ type: "input_audio", transcript }];
		}
		this.emit("conversation.item.input_audio_transcription.completed", {
			item_id: item.id,
			content_index: 0,
			transcript,
		});
	}

	private startResponse(): ActiveResponse {
		this.settleGenerated();
		if (this.response) {
			return this.response;
		}
		// The user's turn is over once the model answers; with VAD the provider may answer before
		// it reports the end of speech.
		this.speechStopped();
		const response: ActiveResponse = {
			id: responseId(),
			output: [],
			message: null,
			usage: null,
			metadata: this.nextMetadata,
			generated: false,
		};
		this.nextMetadata = null;
		this.response = response;
		this.emit("response.created", {
			response: this.renderResponse(response, "in_progress", null),
		});
		return response;
	}

	private ensureMessage(response: ActiveResponse): MessageOutput {
		if (response.message) {
			return response.message;
		}
		const audio = this.state.outputModality === "audio";
		const item: Record<string, unknown> = {
			id: itemId(),
			object: "realtime.item",
			type: "message",
			status: "in_progress",
			role: "assistant",
			content: [],
		};
		const message: MessageOutput = {
			item,
			outputIndex: response.output.length,
			transcript: "",
			text: "",
		};
		response.output.push(item);
		response.message = message;
		const previous = this.addItem(item);
		this.emit("response.output_item.added", {
			response_id: response.id,
			output_index: message.outputIndex,
			item,
		});
		this.emit("conversation.item.added", { previous_item_id: previous, item });
		this.emit("response.content_part.added", {
			response_id: response.id,
			item_id: item.id,
			output_index: message.outputIndex,
			content_index: 0,
			part: audio
				? { type: "audio", transcript: "" }
				: { type: "text", text: "" },
		});
		return message;
	}

	private ids(response: ActiveResponse, message: MessageOutput) {
		return {
			response_id: response.id,
			item_id: message.item.id,
			output_index: message.outputIndex,
			content_index: 0,
		};
	}

	private outputAudio(pcm: Buffer): void {
		this.outputAudioSeconds += pcm.byteLength / 2 / REALTIME_OUTPUT_SAMPLE_RATE;
		if (this.state.outputModality !== "audio") {
			return;
		}
		const response = this.startResponse();
		const message = this.ensureMessage(response);
		const format = JSON.stringify(this.state.outputFormat);
		if (format !== this.encoderFormat) {
			this.encoder = createAudioOutputEncoder(this.state.outputFormat);
			this.encoderFormat = format;
		}
		const encoded = this.encoder.push(pcm);
		if (encoded.byteLength === 0) {
			return;
		}
		this.firstOutputAt ??= Date.now();
		this.state.spoke = true;
		this.emit("response.output_audio.delta", {
			...this.ids(response, message),
			delta: encoded.toString("base64"),
		});
	}

	private outputText(
		kind: "output_text" | "output_transcript",
		text: string,
	): void {
		this.outputTextCharacters += text.length;
		const response = this.startResponse();
		const message = this.ensureMessage(response);
		this.firstOutputAt ??= Date.now();
		if (this.state.outputModality === "audio") {
			if (kind === "output_text") {
				return;
			}
			message.transcript += text;
			this.emit("response.output_audio_transcript.delta", {
				...this.ids(response, message),
				delta: text,
			});
			return;
		}
		// A text session on an audio-only model reads the transcript of its spoken reply.
		message.text += text;
		this.emit("response.output_text.delta", {
			...this.ids(response, message),
			delta: text,
		});
	}

	private closeMessage(response: ActiveResponse, status: string): void {
		const { message } = response;
		if (!message) {
			return;
		}
		response.message = null;
		const ids = this.ids(response, message);
		let part: Record<string, unknown>;
		if (this.state.outputModality === "audio") {
			this.emit("response.output_audio.done", ids);
			this.emit("response.output_audio_transcript.done", {
				...ids,
				transcript: message.transcript,
			});
			part = { type: "audio", transcript: message.transcript };
			message.item.content = [
				{ type: "output_audio", transcript: message.transcript },
			];
		} else {
			this.emit("response.output_text.done", { ...ids, text: message.text });
			part = { type: "text", text: message.text };
			message.item.content = [{ type: "output_text", text: message.text }];
		}
		message.item.status = status;
		this.emit("response.content_part.done", { ...ids, part });
		this.emit("response.output_item.done", {
			response_id: response.id,
			output_index: message.outputIndex,
			item: message.item,
		});
		this.emit("conversation.item.done", { item: message.item });
	}

	private functionCalls(calls: RealtimeFunctionCall[]): void {
		const response = this.startResponse();
		this.closeMessage(response, "completed");
		for (const call of calls) {
			const item: Record<string, unknown> = {
				id: itemId(),
				object: "realtime.item",
				type: "function_call",
				status: "in_progress",
				name: call.name,
				call_id: call.id,
				arguments: "",
			};
			const outputIndex = response.output.length;
			response.output.push(item);
			this.calls.set(call.id, call.name);
			const previous = this.addItem(item);
			this.emit("response.output_item.added", {
				response_id: response.id,
				output_index: outputIndex,
				item,
			});
			this.emit("conversation.item.added", {
				previous_item_id: previous,
				item,
			});
			const ids = {
				response_id: response.id,
				item_id: item.id,
				output_index: outputIndex,
				call_id: call.id,
			};
			this.emit("response.function_call_arguments.delta", {
				...ids,
				delta: call.arguments,
			});
			this.emit("response.function_call_arguments.done", {
				...ids,
				name: call.name,
				arguments: call.arguments,
			});
			item.arguments = call.arguments;
			item.status = "completed";
			this.emit("response.output_item.done", {
				response_id: response.id,
				output_index: outputIndex,
				item,
			});
			this.emit("conversation.item.done", { item });
		}
		this.firstOutputAt ??= Date.now();
		// The model waits for the results: this response is over, the next starts with them.
		this.finishResponse("completed", null);
	}

	private finishResponse(
		status: "completed" | "cancelled" | "incomplete",
		reason: string | null,
	): void {
		const { response } = this;
		if (!response) {
			return;
		}
		this.closeMessage(
			response,
			status === "completed" ? "completed" : "incomplete",
		);
		this.response = null;
		this.completedResponses += 1;
		this.emit("response.done", {
			response: this.renderResponse(response, status, reason),
		});
	}

	private renderResponse(
		response: ActiveResponse,
		status: string,
		reason: string | null,
	): Record<string, unknown> {
		const { state } = this;
		return {
			id: response.id,
			object: "realtime.response",
			status,
			status_details:
				status === "in_progress"
					? null
					: { type: status, ...(reason ? { reason } : {}) },
			output: response.output,
			conversation_id: `conv_${state.id.slice("sess_".length)}`,
			output_modalities: [state.outputModality],
			max_output_tokens: state.maxOutputTokens,
			audio: {
				output: {
					format: state.outputFormat,
					...(state.voice === null ? {} : { voice: state.voice }),
				},
			},
			usage:
				status === "in_progress" ? null : renderResponseUsage(response.usage),
			metadata: response.metadata,
		};
	}

	/** Client content waits for `response.create`. */
	get hasPendingContent(): boolean {
		return this.contentPending || this.pendingResults.length > 0;
	}
}
