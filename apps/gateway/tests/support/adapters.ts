import type { Adapter, UpstreamHttpRequest } from "#adapters/types.ts";

/** The capabilities an adapter declares only if it implements them. */
type Capability =
	| "chat"
	| "imageGeneration"
	| "imageEdit"
	| "videoGeneration"
	| "audioTranscription"
	| "embeddings"
	| "rerank";

/**
 * A capability handler the test knows its adapter has.
 *
 * Every handler is optional on `Adapter` because no provider implements all of them, but a test
 * that named the adapter also knows which operations it offers. Saying so here reports the adapter
 * and the capability if the assumption ever stops holding, instead of failing three calls later on
 * a property of undefined.
 */
export function must<K extends Capability>(
	adapter: Adapter,
	capability: K,
): NonNullable<Adapter[K]> {
	const handler = adapter[capability];
	if (!handler) {
		throw new Error(
			`Adapter "${adapter.key}" does not implement ${capability}`,
		);
	}
	return handler;
}

/** The serialized body of a built upstream request, which every HTTP call has. */
export function bodyOf(request: UpstreamHttpRequest): string {
	const { body } = request;
	if (body === undefined) {
		throw new Error(
			`${request.method} ${request.url} was built without a body`,
		);
	}
	return body;
}

/**
 * The same body, parsed.
 *
 * Defaults to `any`, exactly as `JSON.parse` does: an assertion reaching four levels into a
 * provider payload is the point of these tests, and a fixture that has to be typed first is a
 * fixture nobody writes. Pass a type argument where it helps.
 */
// biome-ignore lint/suspicious/noExplicitAny: mirrors JSON.parse, which is what this replaced.
export function jsonBody<T = any>(request: UpstreamHttpRequest): T {
	return JSON.parse(bodyOf(request)) as T;
}

/** A byte stream over a fixture payload; `Response.body` is null only for a bodyless response. */
export function streamOf(payload: string): ReadableStream<Uint8Array> {
	const { body } = new Response(payload);
	if (body === null) {
		throw new Error("Response(payload) produced no body");
	}
	return body;
}
