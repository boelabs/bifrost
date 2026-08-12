import { GatewayError } from "#core/errors.ts";

import {
	type OperationChildTelemetrySpan,
	finishOperationChildTelemetry,
	startOperationChildTelemetry,
} from "#telemetry/index.ts";

interface SSEMessage {
	data: string;
	event?: string;
	id?: string;
	retry?: number;
}

interface SSEWriter {
	write(value: string): Promise<unknown>;
	writeSSE(message: SSEMessage): Promise<unknown>;
}

export interface DownstreamWriteObservation {
	totalBlockedMs: number;
	maxBlockedMs: number;
	bytes: number;
	writes: number;
	responseOpenedAt: number;
	firstWriteAt: number | null;
	firstSemanticWriteAt: number | null;
	terminalWriteAt: number | null;
	clientAbortAt: number | null;
	writeFailedAt: number | null;
	deliveryState:
		| "opened"
		| "semantic_written"
		| "terminal_written"
		| "client_aborted"
		| "write_failed";
}

const renderSpans = new WeakMap<
	DownstreamWriteObservation,
	OperationChildTelemetrySpan
>();

export function newDownstreamWriteObservation(
	operationId?: string,
): DownstreamWriteObservation {
	const observation: DownstreamWriteObservation = {
		totalBlockedMs: 0,
		maxBlockedMs: 0,
		bytes: 0,
		writes: 0,
		responseOpenedAt: Date.now(),
		firstWriteAt: null,
		firstSemanticWriteAt: null,
		terminalWriteAt: null,
		clientAbortAt: null,
		writeFailedAt: null,
		deliveryState: "opened",
	};
	if (operationId)
		renderSpans.set(
			observation,
			startOperationChildTelemetry(operationId, "render"),
		);
	return observation;
}

export function markDownstreamSemanticWritten(
	observation: DownstreamWriteObservation,
): void {
	observation.firstSemanticWriteAt ??= Date.now();
	if (observation.deliveryState === "opened")
		observation.deliveryState = "semantic_written";
}

export function markDownstreamTerminalWritten(
	observation: DownstreamWriteObservation,
): void {
	observation.terminalWriteAt ??= Date.now();
	observation.deliveryState = "terminal_written";
}

export function markDownstreamClientAborted(
	observation: DownstreamWriteObservation,
): void {
	observation.clientAbortAt ??= Date.now();
	observation.deliveryState = "client_aborted";
}

export function finishDownstreamWriteObservation(
	observation: DownstreamWriteObservation,
	errorCode?: string | null,
): void {
	const span = renderSpans.get(observation);
	if (!span) return;
	finishOperationChildTelemetry(span, errorCode);
	renderSpans.delete(observation);
}

const WRITE_DEADLINE_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

function backpressureError(): GatewayError {
	return new GatewayError({
		class: "server",
		code: "downstream_backpressure",
		message: "Client response write exceeded the downstream deadline",
		failureKind: "gateway",
		deploymentHealth: "neutral",
		retryable: false,
	});
}

async function beforeDeadline(
	write: Promise<unknown>,
	observation?: DownstreamWriteObservation,
	bytes = 0,
): Promise<void> {
	const startedAt = Date.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let completed = false;
	try {
		await Promise.race([
			write,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(backpressureError()),
					WRITE_DEADLINE_MS,
				);
			}),
		]);
		completed = true;
	} catch (error) {
		if (observation) {
			observation.writeFailedAt ??= Date.now();
			observation.deliveryState = "write_failed";
		}
		throw error;
	} finally {
		if (timer) clearTimeout(timer);
		if (observation) {
			if (completed) {
				observation.bytes += bytes;
				observation.writes += 1;
				observation.firstWriteAt ??= Date.now();
			}
			const blockedMs = Date.now() - startedAt;
			observation.totalBlockedMs += blockedMs;
			observation.maxBlockedMs = Math.max(observation.maxBlockedMs, blockedMs);
		}
	}
}

export function writeSSE(
	stream: SSEWriter,
	message: SSEMessage,
	observation?: DownstreamWriteObservation,
): Promise<void> {
	const bytes = Buffer.byteLength(
		`${message.event ? `event: ${message.event}\n` : ""}${message.id ? `id: ${message.id}\n` : ""}${message.retry !== undefined ? `retry: ${message.retry}\n` : ""}${message.data
			.split("\n")
			.map((line) => `data: ${line}\n`)
			.join("")}\n`,
	);
	return beforeDeadline(stream.writeSSE(message), observation, bytes);
}

export function writeSSEHeartbeat(
	stream: SSEWriter,
	observation?: DownstreamWriteObservation,
): Promise<void> {
	return beforeDeadline(stream.write(": keepalive\n\n"), observation, 13);
}

/**
 * Keeps an already-open SSE response alive while work that precedes the first upstream item is
 * pending (routing, retries, and fallback selection). The heartbeat is transport-only and never
 * counts as semantic model progress.
 */
export async function awaitWithSSEHeartbeats<T>(
	pending: Promise<T>,
	heartbeat: () => Promise<void>,
	intervalMs = HEARTBEAT_INTERVAL_MS,
): Promise<T> {
	const settled = pending.then(
		(value) => ({ kind: "value" as const, value }),
		(error: unknown) => ({ kind: "error" as const, error }),
	);
	while (true) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const result = await Promise.race([
			settled,
			new Promise<{ kind: "heartbeat" }>((resolve) => {
				timer = setTimeout(() => resolve({ kind: "heartbeat" }), intervalMs);
			}),
		]);
		if (timer) clearTimeout(timer);
		if (result.kind === "heartbeat") {
			await heartbeat();
			continue;
		}
		if (result.kind === "error") throw result.error;
		return result.value;
	}
}

/** Adds transport heartbeats without treating them as upstream/model progress. */
export async function* withSSEHeartbeats<T>(
	items: AsyncIterable<T>,
	heartbeat: () => Promise<void>,
): AsyncIterable<T> {
	const iterator = items[Symbol.asyncIterator]();
	let pending = iterator.next();
	try {
		while (true) {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const result = await Promise.race([
				pending.then((item) => ({ kind: "item" as const, item })),
				new Promise<{ kind: "heartbeat" }>((resolve) => {
					timer = setTimeout(
						() => resolve({ kind: "heartbeat" }),
						HEARTBEAT_INTERVAL_MS,
					);
				}),
			]);
			if (timer) clearTimeout(timer);
			if (result.kind === "heartbeat") {
				await heartbeat();
				continue;
			}
			if (result.item.done) return;
			pending = iterator.next();
			yield result.item.value;
		}
	} finally {
		await iterator.return?.();
	}
}
