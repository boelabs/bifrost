import { upstreamWebSocket } from "#gateway/instrumentedTransport.ts";
import { abortGatewayError } from "#gateway/abortReason.ts";
import { GatewayError } from "#core/errors.ts";
import type { SSEEvent } from "#core/sse.ts";
import type { RawData } from "ws";

import type {
	ResponsesWebSocketSession,
	ResponsesWebSocketHandler,
	ResponsesWebSocketTurn,
	AdapterContext,
} from "./types.ts";

import {
	responsesEventsToCanonicalChunks,
	buildResponsesRequestBody,
} from "#contracts/openai/responsesTransport.ts";

interface OpenAIResponsesWebSocketOptions {
	label: string;
	resolveConnection(ctx: AdapterContext): {
		url: string;
		headers: Record<string, string>;
	};
	mapError(err: unknown, ctx: AdapterContext): GatewayError;
}

interface QueuedEvent {
	event: SSEEvent;
	type: string;
	raw: Record<string, unknown>;
}

class AsyncEventQueue {
	private readonly values: QueuedEvent[] = [];
	private readonly waiters: Array<{
		resolve: (value: IteratorResult<QueuedEvent>) => void;
		reject: (reason: unknown) => void;
	}> = [];
	private failure: unknown;
	private ended = false;

	push(value: QueuedEvent): void {
		const waiter = this.waiters.shift();
		if (waiter) waiter.resolve({ done: false, value });
		else this.values.push(value);
	}

	end(): void {
		this.ended = true;
		for (const waiter of this.waiters.splice(0))
			waiter.resolve({ done: true, value: undefined });
	}

	fail(error: unknown): void {
		this.failure = error;
		for (const waiter of this.waiters.splice(0)) waiter.reject(error);
	}

	next(): Promise<IteratorResult<QueuedEvent>> {
		if (this.values.length > 0)
			return Promise.resolve({ done: false, value: this.values.shift()! });
		if (this.failure !== undefined) return Promise.reject(this.failure);
		if (this.ended) return Promise.resolve({ done: true, value: undefined });
		return new Promise((resolve, reject) =>
			this.waiters.push({ resolve, reject }),
		);
	}
}

function websocketUrl(httpUrl: string): string {
	const url = new URL(httpUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = `${url.pathname.replace(/\/+$/, "")}/responses`;
	url.search = "";
	url.hash = "";
	return url.toString();
}

function rawDataText(data: RawData): string {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
	if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
	return data.toString("utf8");
}

const TERMINAL_EVENTS = new Set([
	"response.completed",
	"response.incomplete",
	"response.failed",
	"error",
]);

export function buildResponsesWebSocketMessage(
	req: Parameters<typeof buildResponsesRequestBody>[0],
	ctx: AdapterContext,
	options: { previousResponseId?: string; generate: boolean },
): Record<string, unknown> {
	const body = buildResponsesRequestBody(
		req,
		ctx.upstreamModel,
		ctx.meta.reasoning,
	);
	delete body.stream;
	delete body.stream_options;
	return {
		...body,
		type: "response.create",
		...(options.previousResponseId
			? { previous_response_id: options.previousResponseId }
			: {}),
		...(options.generate ? {} : { generate: false }),
	};
}

export function makeOpenAIResponsesWebSocketHandler(
	options: OpenAIResponsesWebSocketOptions,
): ResponsesWebSocketHandler {
	return {
		async connect(ctx): Promise<ResponsesWebSocketSession> {
			const connection = options.resolveConnection(ctx);
			const socket = upstreamWebSocket(ctx, websocketUrl(connection.url), {
				headers: connection.headers,
			});
			let activeQueue: AsyncEventQueue | null = null;
			let closed = false;

			await new Promise<void>((resolve, reject) => {
				const onOpen = () => {
					cleanup();
					resolve();
				};
				const onError = (error: Error) => {
					cleanup();
					reject(options.mapError(error, ctx));
				};
				const onAbort = () => {
					cleanup();
					socket.terminate();
					reject(abortGatewayError(ctx.signal!, "connect"));
				};
				const cleanup = () => {
					socket.off("open", onOpen);
					socket.off("error", onError);
					ctx.signal?.removeEventListener("abort", onAbort);
				};
				socket.once("open", onOpen);
				socket.once("error", onError);
				if (ctx.signal?.aborted) onAbort();
				else ctx.signal?.addEventListener("abort", onAbort, { once: true });
			});

			socket.on("message", (data, isBinary) => {
				if (!activeQueue) return;
				if (isBinary) {
					activeQueue.fail(
						new GatewayError({
							class: "server",
							code: "upstream_websocket_binary_message",
							message: `${options.label}: Responses WebSocket emitted a binary message`,
						}),
					);
					return;
				}
				let raw: Record<string, unknown>;
				try {
					raw = JSON.parse(rawDataText(data)) as Record<string, unknown>;
				} catch (error) {
					activeQueue.fail(
						new GatewayError({
							class: "server",
							code: "upstream_websocket_invalid_json",
							message: `${options.label}: Responses WebSocket emitted invalid JSON`,
							cause: error,
						}),
					);
					return;
				}
				const type = typeof raw.type === "string" ? raw.type : "";
				activeQueue.push({
					type,
					raw,
					event: { event: type, data: JSON.stringify(raw) },
				});
				if (TERMINAL_EVENTS.has(type)) activeQueue.end();
			});
			socket.on("close", (code, reason) => {
				closed = true;
				activeQueue?.fail(
					new GatewayError({
						class: "server",
						code: "upstream_websocket_closed",
						message: `${options.label}: Responses WebSocket closed (${code}: ${reason.toString()})`,
					}),
				);
			});
			socket.on("error", (error) => {
				activeQueue?.fail(options.mapError(error, ctx));
			});

			const session: ResponsesWebSocketSession = {
				get closed() {
					return closed || socket.readyState !== WebSocket.OPEN;
				},
				async create(req, turnOptions): Promise<ResponsesWebSocketTurn> {
					if (this.closed)
						throw new GatewayError({
							class: "server",
							code: "upstream_websocket_closed",
							message: `${options.label}: Responses WebSocket is closed`,
						});
					if (activeQueue)
						throw new GatewayError({
							class: "server",
							code: "upstream_websocket_busy",
							message: `${options.label}: Responses WebSocket already has an active response`,
						});

					const queue = new AsyncEventQueue();
					activeQueue = queue;
					let resolveResponseId!: (id: string | null) => void;
					const upstreamResponseId = new Promise<string | null>((resolve) => {
						resolveResponseId = resolve;
					});
					let responseIdResolved = false;
					const resolveId = (id: string | null) => {
						if (responseIdResolved) return;
						responseIdResolved = true;
						resolveResponseId(id);
					};

					const message = buildResponsesWebSocketMessage(req, ctx, turnOptions);

					const onAbort = () => {
						queue.fail(abortGatewayError(turnOptions.signal));
						socket.close(1000, "turn aborted");
					};
					turnOptions.signal.addEventListener("abort", onAbort, { once: true });
					socket.send(JSON.stringify(message), (error) => {
						if (error) queue.fail(options.mapError(error, ctx));
					});

					async function* events(): AsyncGenerator<SSEEvent> {
						try {
							while (true) {
								const next = await queue.next();
								if (next.done) return;
								const queued = next.value;
								if (
									queued.type === "response.created" ||
									queued.type === "response.in_progress"
								) {
									const response = queued.raw.response as
										| { id?: unknown }
										| undefined;
									if (typeof response?.id === "string") resolveId(response.id);
								}
								yield queued.event;
							}
						} finally {
							resolveId(null);
							turnOptions.signal.removeEventListener("abort", onAbort);
							activeQueue = null;
						}
					}

					return {
						chunks: responsesEventsToCanonicalChunks(events()),
						upstreamResponseId,
					};
				},
				close(code = 1000, reason = "gateway session closed") {
					if (socket.readyState === WebSocket.OPEN) socket.close(code, reason);
					else if (socket.readyState === WebSocket.CONNECTING)
						socket.terminate();
					closed = true;
				},
			};
			return session;
		},
	};
}
