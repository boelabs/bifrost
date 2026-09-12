import type { AdapterContext } from "#adapters/types.ts";
import { abortGatewayError } from "./abortReason.ts";
import WebSocket, { type ClientOptions } from "ws";

/** The only network entry point adapters may use for upstream HTTP calls. */
export async function upstreamFetch(
	ctx: AdapterContext,
	input: string | URL | Request,
	init: RequestInit = {},
): Promise<Response> {
	try {
		const response = await fetch(input, {
			...init,
			...(ctx.signal ? { signal: ctx.signal } : {}),
		});
		if (!response.body) return response;
		ctx.transportStats ??= { upstreamBytes: 0 };
		const stats = ctx.transportStats;
		const counted = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					stats.upstreamBytes += chunk.byteLength;
					controller.enqueue(chunk);
				},
			}),
		);
		return new Response(counted, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers,
		});
	} catch (error) {
		if (ctx.signal?.aborted) throw abortGatewayError(ctx.signal, "headers");
		throw error;
	}
}

/** The only network entry point adapters may use for upstream WebSocket sessions. */
export function upstreamWebSocket(
	ctx: AdapterContext,
	url: string,
	options: ClientOptions,
): WebSocket {
	const socket = new WebSocket(url, options);
	ctx.transportStats ??= { upstreamBytes: 0 };
	const stats = ctx.transportStats;
	socket.on("message", (data) => {
		if (typeof data === "string")
			stats.upstreamBytes += Buffer.byteLength(data);
		else if (data instanceof ArrayBuffer)
			stats.upstreamBytes += data.byteLength;
		else if (Array.isArray(data))
			stats.upstreamBytes += data.reduce(
				(total, part) => total + part.byteLength,
				0,
			);
		else stats.upstreamBytes += data.byteLength;
	});
	const abort = () => socket.terminate();
	if (ctx.signal?.aborted) abort();
	else ctx.signal?.addEventListener("abort", abort, { once: true });
	socket.once("close", () => ctx.signal?.removeEventListener("abort", abort));
	return socket;
}
