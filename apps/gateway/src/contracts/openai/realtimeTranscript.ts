import {
	type CanonicalRealtimeTranscriptionEvent,
	type RealtimeTranscriptionUsage,
	type RealtimeTurnDetection,
	addRealtimeUsage,
} from "#core/realtime.ts";

import {
	RealtimeClientEventError,
	renderRealtimeUsage,
	renderUserAudioItem,
	eventId,
	itemId,
} from "./realtime.ts";

/**
 * Turns a provider's utterance transcripts into OpenAI Realtime conversation items.
 *
 * Providers revise their running guess (Gemini's interim transcript replaces the previous one);
 * OpenAI's deltas only append. Deltas therefore carry only text that extends what was already sent,
 * and the `completed` event carries the authoritative transcript. With manual turns
 * (`turn_detection: null`) an item is the audio between two commits; with server VAD it is one
 * utterance the provider finalized.
 */

interface Item {
	id: string;
	previousId: string | null;
	emitted: string;
	finals: string[];
	discarded: boolean;
	done: boolean;
	grace?: ReturnType<typeof setTimeout>;
}

export interface RealtimeTranscriptTrackerOptions {
	turnDetection: RealtimeTurnDetection;
	/** The item the next one follows, carried across provider sessions. */
	previousItemId: string | null;
	includeInterim: () => boolean;
	/** Milliseconds of audio received so far, for VAD speech events. */
	audioMs: () => number;
	emit: (event: Record<string, unknown>) => void;
	/** How long a committed item waits for its final transcript. */
	commitGraceMs?: number;
}

const COMMIT_EMPTY =
	"Error committing input audio buffer: the buffer is empty.";

function transcriptOf(item: Item, interim = ""): string {
	return [...item.finals, interim]
		.map((part) => part.trim())
		.filter(Boolean)
		.join(" ");
}

export class RealtimeTranscriptTracker {
	private readonly options: RealtimeTranscriptTrackerOptions;
	private open: Item | null = null;
	private awaiting: Item[] = [];
	private pendingUsage: RealtimeTranscriptionUsage | null = null;
	lastItemId: string | null;
	firstOutputAt: number | null = null;
	completedItems = 0;

	constructor(options: RealtimeTranscriptTrackerOptions) {
		this.options = options;
		this.lastItemId = options.previousItemId;
	}

	private get manual(): boolean {
		return this.options.turnDetection === "manual";
	}

	private newItem(): Item {
		const item: Item = {
			id: itemId(),
			previousId: this.lastItemId,
			emitted: "",
			finals: [],
			discarded: false,
			done: false,
		};
		this.lastItemId = item.id;
		return item;
	}

	/** Manual turns: true when this audio starts a new utterance. */
	beforeAudio(): boolean {
		if (!this.manual || this.open) {
			return false;
		}
		this.open = this.newItem();
		return true;
	}

	/**
	 * `input_audio_buffer.commit`. Manual turns close the open item (false when none, which the
	 * caller reports); with VAD the provider owns the turn and the caller only flushes.
	 */
	commit(clientEventId: string | null): void {
		if (!this.manual) {
			return;
		}
		const item = this.open;
		if (!item) {
			throw new RealtimeClientEventError(
				COMMIT_EMPTY,
				"input_audio_buffer_commit_empty",
				null,
				clientEventId,
			);
		}
		this.open = null;
		this.awaitFinal(item);
		this.announceCommitted(item);
	}

	/** `input_audio_buffer.clear`: true when an open manual utterance must be ended upstream. */
	clear(): boolean {
		const item = this.open;
		if (!(this.manual && item)) {
			return false;
		}
		// The audio already reached the provider; its transcript is dropped instead.
		item.discarded = true;
		this.open = null;
		this.awaitFinal(item);
		return true;
	}

	provider(event: CanonicalRealtimeTranscriptionEvent): void {
		if (event.kind === "usage") {
			this.pendingUsage = addRealtimeUsage(this.pendingUsage, event.usage);
			return;
		}
		if (this.manual) {
			const target = this.awaiting[0] ?? this.open;
			if (!target) {
				return;
			}
			if (event.kind === "interim") {
				this.progress(target, transcriptOf(target, event.text));
				return;
			}
			target.finals.push(event.text);
			if (target === this.open) {
				this.progress(target, transcriptOf(target));
			} else {
				this.complete(target);
			}
			return;
		}
		if (!this.open) {
			this.open = this.newItem();
			this.options.emit({
				type: "input_audio_buffer.speech_started",
				event_id: eventId(),
				audio_start_ms: this.options.audioMs(),
				item_id: this.open.id,
			});
		}
		const item = this.open;
		if (event.kind === "interim") {
			this.progress(item, transcriptOf(item, event.text));
			return;
		}
		item.finals.push(event.text);
		this.open = null;
		this.options.emit({
			type: "input_audio_buffer.speech_stopped",
			event_id: eventId(),
			audio_end_ms: this.options.audioMs(),
			item_id: item.id,
		});
		this.announceCommitted(item);
		this.complete(item);
	}

	/** Completes every committed item with what was heard; the session is ending. */
	finish(): void {
		for (const item of [...this.awaiting]) {
			this.complete(item);
		}
	}

	private awaitFinal(item: Item): void {
		this.awaiting.push(item);
		item.grace = setTimeout(
			() => this.complete(item),
			this.options.commitGraceMs ?? 10_000,
		);
		item.grace.unref?.();
	}

	private announceCommitted(item: Item): void {
		this.options.emit({
			type: "input_audio_buffer.committed",
			event_id: eventId(),
			previous_item_id: item.previousId,
			item_id: item.id,
		});
		this.options.emit({
			type: "conversation.item.added",
			event_id: eventId(),
			previous_item_id: item.previousId,
			item: renderUserAudioItem(item.id),
		});
	}

	private progress(item: Item, transcript: string): void {
		if (item.discarded) {
			return;
		}
		this.firstOutputAt ??= Date.now();
		if (this.options.includeInterim()) {
			this.options.emit({
				type: "conversation.item.input_audio_transcription.interim",
				event_id: eventId(),
				item_id: item.id,
				content_index: 0,
				transcript,
			});
		}
		if (!transcript.startsWith(item.emitted)) {
			return;
		}
		const delta = transcript.slice(item.emitted.length);
		if (delta === "") {
			return;
		}
		item.emitted = transcript;
		this.options.emit({
			type: "conversation.item.input_audio_transcription.delta",
			event_id: eventId(),
			item_id: item.id,
			content_index: 0,
			delta,
		});
	}

	private complete(item: Item): void {
		if (item.done) {
			return;
		}
		item.done = true;
		clearTimeout(item.grace);
		this.awaiting = this.awaiting.filter((waiting) => waiting !== item);
		if (item.discarded) {
			return;
		}
		const transcript = transcriptOf(item);
		if (transcript.startsWith(item.emitted) && transcript !== item.emitted) {
			this.progress(item, transcript);
		}
		const usage = this.pendingUsage;
		this.pendingUsage = null;
		this.completedItems += 1;
		this.options.emit({
			type: "conversation.item.input_audio_transcription.completed",
			event_id: eventId(),
			item_id: item.id,
			content_index: 0,
			transcript,
			...(usage ? { usage: renderRealtimeUsage(usage) } : {}),
		});
	}
}
