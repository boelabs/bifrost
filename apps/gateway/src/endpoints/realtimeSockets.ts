import { RealtimeClientEventError } from "#contracts/openai/realtime.ts";
import type { DownstreamWriteObservation } from "./runtime/sse.ts";
import { GatewayError } from "#core/errors.ts";
import type { WSContext } from "hono/ws";
import { env } from "#config/env.ts";

/**
 * What every `/v1/realtime` socket shares, whatever kind of session it carries: the connection
 * limits, the message rules, and shutdown.
 */

export const REALTIME_MAX_MS = 60 * 60 * 1000;
export const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
export const MAX_QUEUED_EVENTS = 2000;

export interface RealtimeSocketEntry {
	scopeKey: string;
	socket: WSContext | null;
	/** A provider session is open: shutdown waits for its usage to be logged. */
	busy: () => boolean;
	/** Ends the provider session and logs it; idempotent. */
	close: () => Promise<void>;
}

const activeRealtimeSockets = new Set<RealtimeSocketEntry>();

/** Registers a socket, or refuses it when the process or the key is at its connection limit. */
export function registerRealtimeSocket(entry: RealtimeSocketEntry): void {
	const forScope = [...activeRealtimeSockets].filter(
		(active) => active.scopeKey === entry.scopeKey,
	).length;
	if (
		activeRealtimeSockets.size >= env.REALTIME_WEBSOCKET_MAX_CONNECTIONS ||
		forScope >= env.REALTIME_WEBSOCKET_MAX_CONNECTIONS_PER_KEY
	) {
		throw new GatewayError({
			class: "rate_limit",
			code: "websocket_connection_limit_exceeded",
			message: "Realtime WebSocket connection concurrency limit exceeded",
			publicMessage: "Realtime WebSocket connection limit exceeded.",
		});
	}
	activeRealtimeSockets.add(entry);
}

export function unregisterRealtimeSocket(entry: RealtimeSocketEntry): void {
	activeRealtimeSockets.delete(entry);
}

export function sendRealtimeEvent(
	socket: WSContext | null,
	value: Record<string, unknown>,
	downstream?: DownstreamWriteObservation,
): void {
	if (socket?.readyState !== 1) {
		return;
	}
	const serialized = JSON.stringify(value);
	socket.send(serialized);
	if (downstream) {
		downstream.bytes += Buffer.byteLength(serialized);
	}
}

/** A client message as text, refusing binary frames and oversized messages. */
export function realtimeMessageJson(value: unknown): unknown {
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else if (value instanceof ArrayBuffer) {
		text = Buffer.from(value).toString("utf8");
	} else if (ArrayBuffer.isView(value)) {
		text = Buffer.from(
			value.buffer,
			value.byteOffset,
			value.byteLength,
		).toString("utf8");
	} else {
		throw new RealtimeClientEventError(
			"Realtime messages must be JSON text.",
			"invalid_event",
			null,
			null,
		);
	}
	if (Buffer.byteLength(text, "utf8") > MAX_MESSAGE_BYTES) {
		throw new RealtimeClientEventError(
			"Realtime message is too large.",
			"invalid_event",
			null,
			null,
		);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new RealtimeClientEventError(
			"Invalid JSON.",
			"invalid_json",
			null,
			null,
		);
	}
}

export function sessionExpiredError(): GatewayError {
	return new GatewayError({
		class: "bad_request",
		code: "session_expired",
		message: "Realtime session reached 60 minutes",
		publicMessage: "Your session hit the maximum duration of 60 minutes.",
	});
}

export function eventQueueLimitError(): GatewayError {
	return new GatewayError({
		class: "rate_limit",
		code: "websocket_event_queue_limit_exceeded",
		message: "Realtime WebSocket queued-event limit exceeded",
		publicMessage: "Too many queued events.",
	});
}

/**
 * Hangs up live realtime sockets during process shutdown. Idle ones (no provider session) go first;
 * the rest get 1012 "service restarting" when the drain window closes, after their usage is logged.
 */
export async function closeRealtimeWebSockets(
	options: { idleOnly?: boolean } = {},
): Promise<void> {
	const closing: Promise<void>[] = [];
	for (const entry of activeRealtimeSockets) {
		if (options.idleOnly && entry.busy()) {
			continue;
		}
		const { socket } = entry;
		closing.push(
			entry.close().finally(() => socket?.close(1012, "service restarting")),
		);
	}
	await Promise.allSettled(closing);
}
