import type { CanonicalTranscriptionStreamEvent } from "#core/audio.ts";
import type { CanonicalImageStreamEvent } from "#core/images.ts";
import type { ExecutionPolicy } from "#core/executionPolicy.ts";
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

function timeoutError(
	phase: "first_output" | "idle" | "reasoning_only",
): GatewayError {
	return new GatewayError({
		class: "timeout",
		code: `upstream_${phase}_timeout`,
		message: `Upstream stream exceeded the ${phase.replaceAll("_", " ")} deadline`,
		failureKind: "transient",
		deploymentHealth: "penalize",
	});
}

async function nextBefore<T>(
	iterator: AsyncIterator<T>,
	deadline: number | null,
	phase: "first_output" | "idle" | "reasoning_only",
): Promise<IteratorResult<T>> {
	if (deadline === null) return iterator.next();
	const remaining = deadline - Date.now();
	if (remaining <= 0) throw timeoutError(phase);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			iterator.next(),
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(timeoutError(phase)), remaining);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
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
	}
}

export function chatChunkSemantic(
	chunk: CanonicalChatStreamChunk,
): StreamSemantic {
	if (chunk.choices.some((choice) => (choice.delta.toolCalls?.length ?? 0) > 0))
		return "tool";
	if (
		chunk.choices.some(
			(choice) =>
				(choice.delta.content?.length ?? 0) > 0 ||
				(choice.delta.refusal?.length ?? 0) > 0 ||
				choice.delta.audio !== undefined,
		)
	)
		return "content";
	if (chunk.choices.some((choice) => (choice.delta.reasoning?.length ?? 0) > 0))
		return "reasoning";
	if (chunk.usage !== undefined && chunk.usage !== null) return "usage";
	return "metadata";
}

export function terminalForChatResponse(
	response: import("#core/canonical.ts").CanonicalChatResponse,
): CanonicalTerminal {
	if (response.choices.length === 0)
		throw protocolError("Upstream response contained no choices");
	const reasons = response.choices.map((choice) => choice.finishReason);
	if (reasons.some((reason) => reason === null))
		throw protocolError("Upstream response omitted a terminal reason");
	for (const choice of response.choices) {
		const hasOutput =
			(choice.message.content?.length ?? 0) > 0 ||
			(choice.message.reasoning?.length ?? 0) > 0 ||
			(choice.message.refusal?.length ?? 0) > 0 ||
			(choice.message.toolCalls?.length ?? 0) > 0 ||
			choice.message.audio != null;
		if (!hasOutput && choice.finishReason === "stop")
			throw protocolError(
				"Upstream response completed without semantic output",
			);
		if (
			choice.finishReason === "tool_calls" &&
			(choice.message.toolCalls?.length ?? 0) === 0
		)
			throw protocolError(
				"Upstream response declared tool calls without a tool call",
			);
	}
	const normalizedReasons = reasons as CanonicalFinishReason[];
	const adapterTerminal = adapterDiagnostics(response)?.terminal;
	if (adapterTerminal) return { ...adapterTerminal, usage: response.usage };
	const uniqueReasons = new Set(normalizedReasons);
	if (uniqueReasons.size === 1)
		return terminalForFinish(normalizedReasons[0]!, response.usage);
	return {
		outcome: normalizedReasons.includes("length")
			? "incomplete"
			: normalizedReasons.every((reason) => reason === "content_filter")
				? "blocked"
				: "completed",
		reason: "other",
		usage: response.usage,
	};
}

export function completedTerminal(
	usage: Usage | null = null,
): CanonicalTerminal {
	return { outcome: "completed", reason: "stop", usage };
}

export function observeChatStream(
	chunks: AsyncIterable<CanonicalChatStreamChunk>,
	policy?: ExecutionPolicy,
	contextDiagnostics?: AdapterDiagnostics,
): ObservedStream<CanonicalChatStreamChunk> {
	const observation = emptyObservation();
	if (contextDiagnostics) observation.diagnostics = contextDiagnostics;
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
			let progressDeadline = policy ? Date.now() + policy.firstOutputMs : null;
			let progressPhase: "first_output" | "idle" = "first_output";
			let reasoningDeadline: number | null = null;
			const iterator = chunks[Symbol.asyncIterator]();
			while (true) {
				const activeDeadline =
					reasoningDeadline !== null &&
					(progressDeadline === null || reasoningDeadline < progressDeadline)
						? reasoningDeadline
						: progressDeadline;
				const phase =
					activeDeadline === reasoningDeadline && reasoningDeadline !== null
						? "reasoning_only"
						: progressPhase;
				const next = await nextBefore(iterator, activeDeadline, phase);
				if (next.done) {
					observation.transportTerminator =
						contextDiagnostics?.transportTerminator ?? "eof";
					break;
				}
				const chunk = next.value;
				lastChunk = chunk;
				const semantic = chatChunkSemantic(chunk);
				const diagnostics = adapterDiagnostics(chunk);
				if (diagnostics) {
					if (diagnostics.terminal) {
						// Some upstreams repeat the same terminal evidence on a trailing usage or
						// metadata frame. Collapse equivalent evidence, but never contradictions.
						if (
							adapterTerminal &&
							(adapterTerminal.outcome !== diagnostics.terminal.outcome ||
								adapterTerminal.reason !== diagnostics.terminal.reason)
						)
							throw protocolError(
								"Upstream stream emitted conflicting adapter terminals",
							);
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
				if (semantic !== "metadata" && semantic !== "usage") {
					progressPhase = "idle";
					progressDeadline = policy?.idleMs ? Date.now() + policy.idleMs : null;
				}
				if (semantic === "reasoning" && reasoningDeadline === null)
					reasoningDeadline = policy?.reasoningOnlyMs
						? Date.now() + policy.reasoningOnlyMs
						: null;
				if (semantic === "content" || semantic === "tool")
					reasoningDeadline = null;
				if (chunk.usage) {
					usage = chunk.usage;
					observation.usage = chunk.usage;
				}
				for (const choice of chunk.choices) {
					const state = choices.get(choice.index) ?? {
						finish: null,
						hasOutput: false,
						hasTool: false,
					};
					const delta = choice.delta;
					const hasTool = (delta.toolCalls?.length ?? 0) > 0;
					const hasOutput =
						hasTool ||
						(delta.content?.length ?? 0) > 0 ||
						(delta.reasoning?.length ?? 0) > 0 ||
						(delta.refusal?.length ?? 0) > 0 ||
						delta.audio !== undefined;
					state.hasTool ||= hasTool;
					state.hasOutput ||= hasOutput;
					if (choice.finishReason !== null) {
						if (
							state.finish !== null &&
							state.finish !== choice.finishReason &&
							!(
								[state.finish, choice.finishReason].includes("stop") &&
								[state.finish, choice.finishReason].includes("tool_calls")
							)
						)
							throw protocolError(
								`Upstream stream emitted conflicting terminal reasons for choice ${choice.index}`,
							);
						state.finish =
							state.finish === "tool_calls" ||
							choice.finishReason === "tool_calls"
								? "tool_calls"
								: choice.finishReason;
					}
					choices.set(choice.index, state);
				}

				// Provider finish reasons are wire evidence, not the public terminal. Holding
				// them until EOF prevents a provider that repeats or emits finish evidence
				// before trailing semantic parts from prematurely closing the public stream.
				if (chunk.choices.some((choice) => choice.finishReason !== null)) {
					const normalized = {
						...chunk,
						choices: chunk.choices.map((choice) => ({
							...choice,
							finishReason: null,
						})),
					};
					yield diagnostics
						? attachAdapterDiagnostics(normalized, diagnostics)
						: normalized;
				} else {
					yield chunk;
				}
			}
			if (choices.size === 0 || lastChunk === null)
				throw protocolError(
					"Upstream stream ended without a semantic terminal",
				);

			const terminalChoices = [...choices.entries()]
				.sort(([left], [right]) => left - right)
				.map(([index, state]) => {
					if (state.finish === null)
						throw protocolError(
							`Upstream stream ended without a terminal reason for choice ${index}`,
						);
					const finish =
						state.hasTool && state.finish === "stop"
							? "tool_calls"
							: state.finish;
					if (
						!state.hasOutput &&
						finish === "stop" &&
						observation.diagnostics?.metadata?.emptyOutputAllowed !== true
					)
						throw protocolError(
							`Upstream stream completed choice ${index} without semantic output`,
						);
					if (finish === "tool_calls" && !state.hasTool)
						throw protocolError(
							`Upstream stream completed choice ${index} with tool_calls but emitted no tool call`,
						);
					return { index, delta: {}, finishReason: finish };
				});
			const reasons = terminalChoices.map((choice) => choice.finishReason);
			const uniqueReasons = new Set(reasons);
			observation.terminal = adapterTerminal
				? { ...adapterTerminal, usage }
				: uniqueReasons.size === 1
					? terminalForFinish(reasons[0]!, usage)
					: {
							outcome: reasons.includes("length")
								? "incomplete"
								: reasons.every((reason) => reason === "content_filter")
									? "blocked"
									: "completed",
							reason: "other",
							usage,
						};
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
	policy?: ExecutionPolicy,
	contextDiagnostics?: AdapterDiagnostics,
): ObservedStream<CanonicalImageStreamEvent> {
	const observation = emptyObservation();
	if (contextDiagnostics) observation.diagnostics = contextDiagnostics;
	return {
		observation,
		items: (async function* () {
			let completed = false;
			const iterator = events[Symbol.asyncIterator]();
			let deadline = policy ? Date.now() + policy.firstOutputMs : null;
			while (true) {
				const next = await nextBefore(
					iterator,
					deadline,
					observation.firstOutputAt === null ? "first_output" : "idle",
				);
				if (next.done) {
					observation.transportTerminator =
						contextDiagnostics?.transportTerminator ?? "eof";
					break;
				}
				const event = next.value;
				if (completed)
					throw protocolError(
						"Image stream emitted data after its terminal event",
					);
				recordFrame(observation, "media");
				deadline = policy?.idleMs ? Date.now() + policy.idleMs : null;
				if (event.kind === "completed") {
					if (completed)
						throw protocolError(
							"Image stream emitted more than one terminal event",
						);
					completed = true;
				}
				yield event;
			}
			if (!completed)
				throw protocolError("Image stream ended without a completed event");
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
	policy?: ExecutionPolicy,
	contextDiagnostics?: AdapterDiagnostics,
): ObservedStream<CanonicalTranscriptionStreamEvent> {
	const observation = emptyObservation();
	if (contextDiagnostics) observation.diagnostics = contextDiagnostics;
	return {
		observation,
		items: (async function* () {
			let completed = false;
			const iterator = events[Symbol.asyncIterator]();
			let deadline = policy ? Date.now() + policy.firstOutputMs : null;
			while (true) {
				const next = await nextBefore(
					iterator,
					deadline,
					observation.firstOutputAt === null ? "first_output" : "idle",
				);
				if (next.done) {
					observation.transportTerminator =
						contextDiagnostics?.transportTerminator ?? "eof";
					break;
				}
				const event = next.value;
				if (completed)
					throw protocolError(
						"Transcription stream emitted data after its terminal event",
					);
				recordFrame(observation, event.kind === "delta" ? "content" : "usage");
				deadline = policy?.idleMs ? Date.now() + policy.idleMs : null;
				if (event.kind === "done") {
					if (completed)
						throw protocolError(
							"Transcription stream emitted more than one terminal event",
						);
					completed = true;
				}
				yield event;
			}
			if (!completed)
				throw protocolError("Transcription stream ended without a done event");
			observation.terminal = {
				outcome: "completed",
				reason: "stop",
				usage: null,
			};
		})(),
	};
}
