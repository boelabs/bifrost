import type { CanonicalTranscriptionStreamEvent } from "#core/audio.ts";
import type { CanonicalImageStreamEvent } from "#core/images.ts";
import type { AdapterDiagnostics } from "#adapters/types.ts";
import { GatewayError } from "#core/errors.ts";
import type { Usage } from "#core/usage.ts";

import type {
	CanonicalChatStreamChunk,
	CanonicalFinishReason,
} from "#core/canonical.ts";

import {
	attachAdapterDiagnostics,
	adapterDiagnostics,
} from "#adapters/diagnostics.ts";

export type CompletionOutcome = "completed" | "incomplete" | "blocked";

export type CompletionReason =
	| "stop"
	| "length"
	| "tool_calls"
	| "content_filter"
	| "refusal"
	| "other";

export interface CanonicalTerminal {
	outcome: CompletionOutcome;
	reason: CompletionReason;
	usage: Usage | null;
}

export type StreamSemantic =
	| "metadata"
	| "reasoning"
	| "content"
	| "tool"
	| "media"
	| "usage";

export interface StreamObservation {
	frames: number;
	metadataFrames: number;
	reasoningFrames: number;
	contentFrames: number;
	toolFrames: number;
	mediaFrames: number;
	usageFrames: number;
	firstEventAt: number | null;
	firstReasoningAt: number | null;
	firstOutputAt: number | null;
	lastEventAt: number | null;
	maxInterEventGapMs: number;
	usage: Usage | null;
	transportTerminator:
		| "eof"
		| "done_marker"
		| "semantic_event"
		| "websocket_turn"
		| null;
	terminal: CanonicalTerminal | null;
	diagnostics?: AdapterDiagnostics;
}

export interface ObservedStream<T> {
	items: AsyncIterable<T>;
	observation: StreamObservation;
}

function protocolError(message: string): GatewayError {
	return new GatewayError({
		class: "server",
		code: "upstream_protocol_error",
		message,
		failureKind: "transient",
		deploymentHealth: "penalize",
	});
}

/**
 * What a set of disagreeing finish reasons adds up to.
 *
 * One choice cut short makes the whole response incomplete; only a unanimous content filter makes
 * it blocked. Anything else completed, whatever the individual choices said.
 */
function mixedOutcome(
	reasons: readonly CanonicalFinishReason[],
): "incomplete" | "blocked" | "completed" {
	if (reasons.includes("length")) {
		return "incomplete";
	}
	return reasons.every((reason) => reason === "content_filter")
		? "blocked"
		: "completed";
}

function terminalForFinish(
	reason: CanonicalFinishReason,
	usage: Usage | null,
): CanonicalTerminal {
	switch (reason) {
		case "length":
			return { outcome: "incomplete", reason, usage };
		case "content_filter":
			return { outcome: "blocked", reason, usage };
		default:
			return { outcome: "completed", reason, usage };
	}
}

function emptyObservation(): StreamObservation {
	return {
		frames: 0,
		metadataFrames: 0,
		reasoningFrames: 0,
		contentFrames: 0,
		toolFrames: 0,
		mediaFrames: 0,
		usageFrames: 0,
		firstEventAt: null,
		firstReasoningAt: null,
		firstOutputAt: null,
		lastEventAt: null,
		maxInterEventGapMs: 0,
		usage: null,
		transportTerminator: null,
		terminal: null,
	};
}

function recordFrame(
	observation: StreamObservation,
	semantic: StreamSemantic,
): void {
	const now = Date.now();
	observation.frames += 1;
	observation.firstEventAt ??= now;
	if (observation.lastEventAt !== null) {
		observation.maxInterEventGapMs = Math.max(
			observation.maxInterEventGapMs,
			now - observation.lastEventAt,
		);
	}
	observation.lastEventAt = now;
	switch (semantic) {
		case "metadata":
			observation.metadataFrames += 1;
			break;
		case "reasoning":
			observation.reasoningFrames += 1;
			observation.firstReasoningAt ??= now;
			observation.firstOutputAt ??= now;
			break;
		case "content":
			observation.contentFrames += 1;
			observation.firstOutputAt ??= now;
			break;
		case "tool":
			observation.toolFrames += 1;
			observation.firstOutputAt ??= now;
			break;
		case "media":
			observation.mediaFrames += 1;
			observation.firstOutputAt ??= now;
			break;
		case "usage":
			observation.usageFrames += 1;
			break;
		default:
			break;
	}
}

export function chatChunkSemantic(
	chunk: CanonicalChatStreamChunk,
): StreamSemantic {
	if (
		chunk.choices.some((choice) => (choice.delta.toolCalls?.length ?? 0) > 0)
	) {
		return "tool";
	}
	if (
		chunk.choices.some(
			(choice) =>
				(choice.delta.content?.length ?? 0) > 0 ||
				(choice.delta.refusal?.length ?? 0) > 0 ||
				choice.delta.audio !== undefined,
		)
	) {
		return "content";
	}
	if (
		chunk.choices.some((choice) => (choice.delta.reasoning?.length ?? 0) > 0)
	) {
		return "reasoning";
	}
	if (chunk.usage !== undefined && chunk.usage !== null) {
		return "usage";
	}
	return "metadata";
}

/**
 * Choices whose finish reason the upstream omitted are read as finished the way the output shows:
 * with tool calls, `tool_calls`, otherwise `stop`. The caller still receives the upstream's own
 * `null`; this only decides how the operation is recorded.
 */
function inferredFinish(hasTool: boolean): CanonicalFinishReason {
	return hasTool ? "tool_calls" : "stop";
}

export function terminalForChatResponse(
	response: import("#core/canonical.ts").CanonicalChatResponse,
): CanonicalTerminal {
	if (response.choices.length === 0) {
		throw protocolError("Upstream response contained no choices");
	}
	const adapterTerminal = adapterDiagnostics(response)?.terminal;
	if (adapterTerminal) {
		return { ...adapterTerminal, usage: response.usage };
	}
	const reasons = response.choices.map(
		(choice) =>
			choice.finishReason ??
			inferredFinish((choice.message.toolCalls?.length ?? 0) > 0),
	);
	const uniqueReasons = new Set(reasons);
	const [onlyReason] = reasons;
	if (uniqueReasons.size === 1 && onlyReason !== undefined) {
		return terminalForFinish(onlyReason, response.usage);
	}
	return {
		outcome: mixedOutcome(reasons),
		reason: "other",
		usage: response.usage,
	};
}

/**
 * Departures from the protocol the gateway tolerates, as the upstream's own SDK would, and records
 * so an operator can still see them.
 */
export function chatResponseAnomalies(
	response: import("#core/canonical.ts").CanonicalChatResponse,
): string[] {
	const anomalies = new Set<string>();
	for (const choice of response.choices) {
		const hasTool = (choice.message.toolCalls?.length ?? 0) > 0;
		const hasOutput =
			hasTool ||
			(choice.message.content?.length ?? 0) > 0 ||
			(choice.message.reasoning?.length ?? 0) > 0 ||
			(choice.message.refusal?.length ?? 0) > 0 ||
			choice.message.audio != null;
		if (choice.finishReason === null) {
			anomalies.add("missing_finish_reason");
		}
		if (!hasOutput) {
			anomalies.add("empty_output");
		}
		if (choice.finishReason === "tool_calls" && !hasTool) {
			anomalies.add("tool_calls_without_tool_call");
		}
	}
	return [...anomalies];
}

export function completedTerminal(
	usage: Usage | null = null,
): CanonicalTerminal {
	return { outcome: "completed", reason: "stop", usage };
}

function recordAnomaly(observation: StreamObservation, anomaly: string): void {
	const diagnostics = observation.diagnostics ?? {};
	const metadata = diagnostics.metadata ?? {};
	const anomalies = Array.isArray(metadata.anomalies)
		? (metadata.anomalies as string[])
		: [];
	if (!anomalies.includes(anomaly)) {
		anomalies.push(anomaly);
	}
	diagnostics.metadata = { ...metadata, anomalies };
	observation.diagnostics = diagnostics;
}

/** Whether the adapter saw the protocol's own end marker ([DONE], message_stop, a terminal event). */
function protocolTerminated(
	diagnostics: AdapterDiagnostics | undefined,
): boolean {
	const terminator = diagnostics?.transportTerminator;
	return (
		terminator === "done_marker" ||
		terminator === "semantic_event" ||
		terminator === "websocket_turn"
	);
}

/**
 * Observes a canonical chat stream and decides how it ended.
 *
 * The bar is the upstream's own SDK, not a stricter one: a stream that finished every choice, or
 * reached the protocol's end marker, is complete even when the upstream skipped `[DONE]`, omitted a
 * finish reason or produced no text. Those are recorded as anomalies. Only a stream that stops with
 * neither - a dropped connection - fails, because the caller would otherwise take a cut-off answer
 * for a whole one.
 *
 * Finish reasons are held until the stream ends and then emitted on one terminal chunk: renderers
 * close their protocol (message_stop, response.completed) on it, so it must come last.
 */
export function observeChatStream(
	chunks: AsyncIterable<CanonicalChatStreamChunk>,
	contextDiagnostics?: AdapterDiagnostics,
): ObservedStream<CanonicalChatStreamChunk> {
	const observation = emptyObservation();
	if (contextDiagnostics) {
		observation.diagnostics = contextDiagnostics;
	}
	return {
		observation,
		items: (async function* () {
			let adapterTerminal: AdapterDiagnostics["terminal"];
			let usage: Usage | null = null;
			let lastChunk: CanonicalChatStreamChunk | null = null;
			const choices = new Map<
				number,
				{
					finish: CanonicalFinishReason | null;
					hasOutput: boolean;
					hasTool: boolean;
				}
			>();
			for await (const chunk of chunks) {
				lastChunk = chunk;
				const semantic = chatChunkSemantic(chunk);
				const diagnostics = adapterDiagnostics(chunk);
				if (diagnostics) {
					if (diagnostics.terminal) {
						if (
							adapterTerminal &&
							(adapterTerminal.outcome !== diagnostics.terminal.outcome ||
								adapterTerminal.reason !== diagnostics.terminal.reason)
						) {
							recordAnomaly(observation, "conflicting_terminal");
						}
						adapterTerminal = diagnostics.terminal;
					}
					const accumulated = observation.diagnostics ?? {};
					Object.assign(accumulated, diagnostics, {
						metadata: {
							...(accumulated.metadata ?? {}),
							...(diagnostics.metadata ?? {}),
						},
					});
					observation.diagnostics = accumulated;
				}
				recordFrame(observation, semantic);
				if (chunk.usage) {
					({ usage } = chunk);
					observation.usage = chunk.usage;
				}
				for (const choice of chunk.choices) {
					const state = choices.get(choice.index) ?? {
						finish: null,
						hasOutput: false,
						hasTool: false,
					};
					const { delta } = choice;
					const hasTool = (delta.toolCalls?.length ?? 0) > 0;
					state.hasTool ||= hasTool;
					state.hasOutput ||=
						hasTool ||
						(delta.content?.length ?? 0) > 0 ||
						(delta.reasoning?.length ?? 0) > 0 ||
						(delta.refusal?.length ?? 0) > 0 ||
						delta.audio !== undefined;
					if (choice.finishReason !== null) {
						const pair = [state.finish, choice.finishReason];
						if (
							state.finish !== null &&
							state.finish !== choice.finishReason &&
							!(pair.includes("stop") && pair.includes("tool_calls"))
						) {
							recordAnomaly(observation, "conflicting_finish_reason");
						}
						state.finish =
							state.finish === "tool_calls" ||
							choice.finishReason === "tool_calls"
								? "tool_calls"
								: choice.finishReason;
					}
					choices.set(choice.index, state);
				}

				if (!chunk.choices.some((choice) => choice.finishReason !== null)) {
					yield chunk;
					continue;
				}
				const held = {
					...chunk,
					choices: chunk.choices.map((choice) => ({
						...choice,
						finishReason: null,
					})),
				};
				// A frame that only carried the finish reason has nothing left to say until the end.
				const carriesMore =
					held.usage != null ||
					held.choices.some((choice) => Object.keys(choice.delta).length > 0);
				if (carriesMore) {
					yield diagnostics
						? attachAdapterDiagnostics(held, diagnostics)
						: held;
				}
			}
			observation.transportTerminator =
				contextDiagnostics?.transportTerminator ?? "eof";
			const terminated = protocolTerminated(contextDiagnostics);
			if (choices.size === 0 || lastChunk === null) {
				throw protocolError(
					terminated
						? "Upstream stream ended without any choice"
						: "Upstream stream ended before any output",
				);
			}

			const terminalChoices = [...choices.entries()]
				.sort(([left], [right]) => left - right)
				.map(([index, state]) => {
					let { finish } = state;
					if (finish === null) {
						if (!(terminated || adapterTerminal)) {
							throw new GatewayError({
								class: "server",
								code: "upstream_stream_truncated",
								message: `Upstream stream ended without finishing choice ${index}`,
								failureKind: "transient",
								deploymentHealth: "penalize",
							});
						}
						recordAnomaly(observation, "missing_finish_reason");
						finish = inferredFinish(state.hasTool);
					}
					if (state.hasTool && finish === "stop") {
						finish = "tool_calls";
					}
					if (
						!state.hasOutput &&
						observation.diagnostics?.metadata?.emptyOutputAllowed !== true
					) {
						recordAnomaly(observation, "empty_output");
					}
					if (finish === "tool_calls" && !state.hasTool) {
						recordAnomaly(observation, "tool_calls_without_tool_call");
					}
					return { index, delta: {}, finishReason: finish };
				});
			const reasons = terminalChoices.map((choice) => choice.finishReason);
			const uniqueReasons = new Set(reasons);
			const [onlyReason] = reasons;
			if (adapterTerminal) {
				observation.terminal = { ...adapterTerminal, usage };
			} else if (uniqueReasons.size === 1 && onlyReason !== undefined) {
				observation.terminal = terminalForFinish(onlyReason, usage);
			} else {
				observation.terminal = {
					outcome: mixedOutcome(reasons),
					reason: "other",
					usage,
				};
			}
			const terminalChunk: CanonicalChatStreamChunk = {
				id: lastChunk.id,
				created: lastChunk.created,
				model: lastChunk.model,
				choices: terminalChoices,
			};
			yield observation.diagnostics
				? attachAdapterDiagnostics(terminalChunk, observation.diagnostics)
				: terminalChunk;
		})(),
	};
}

export function observeImageStream(
	events: AsyncIterable<CanonicalImageStreamEvent>,
	contextDiagnostics?: AdapterDiagnostics,
): ObservedStream<CanonicalImageStreamEvent> {
	const observation = emptyObservation();
	if (contextDiagnostics) {
		observation.diagnostics = contextDiagnostics;
	}
	return {
		observation,
		items: (async function* () {
			let completed = false;
			for await (const event of events) {
				if (completed) {
					throw protocolError(
						"Image stream emitted data after its terminal event",
					);
				}
				recordFrame(observation, "media");
				if (event.kind === "completed") {
					if (completed) {
						throw protocolError(
							"Image stream emitted more than one terminal event",
						);
					}
					completed = true;
				}
				yield event;
			}
			observation.transportTerminator =
				contextDiagnostics?.transportTerminator ?? "eof";
			if (!completed) {
				throw protocolError("Image stream ended without a completed event");
			}
			observation.terminal = {
				outcome: "completed",
				reason: "stop",
				usage: null,
			};
		})(),
	};
}

export function observeTranscriptionStream(
	events: AsyncIterable<CanonicalTranscriptionStreamEvent>,
	contextDiagnostics?: AdapterDiagnostics,
): ObservedStream<CanonicalTranscriptionStreamEvent> {
	const observation = emptyObservation();
	if (contextDiagnostics) {
		observation.diagnostics = contextDiagnostics;
	}
	return {
		observation,
		items: (async function* () {
			let completed = false;
			for await (const event of events) {
				if (completed) {
					throw protocolError(
						"Transcription stream emitted data after its terminal event",
					);
				}
				recordFrame(observation, event.kind === "delta" ? "content" : "usage");
				if (event.kind === "done") {
					if (completed) {
						throw protocolError(
							"Transcription stream emitted more than one terminal event",
						);
					}
					completed = true;
				}
				yield event;
			}
			observation.transportTerminator =
				contextDiagnostics?.transportTerminator ?? "eof";
			if (!completed) {
				throw protocolError("Transcription stream ended without a done event");
			}
			observation.terminal = {
				outcome: "completed",
				reason: "stop",
				usage: null,
			};
		})(),
	};
}
