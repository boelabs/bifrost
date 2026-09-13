import { csrfTokenFromDocument } from "#/shared/api/csrf.ts";
import type { FetchLike } from "./api";

/**
 * The browser's own calls to the gateway, for the operations that are a single request.
 *
 * Chat goes through the AI SDK (`api.ts`); everything else — images, embeddings, reranking,
 * transcription — is one request and one answer, so it is sent from here. Same route either way:
 * this app's `/api/v1` relay, with the operator's session cookie and the double-submit token the
 * gateway demands on a mutation. Nothing here ever carries an API key: the session is the
 * credential.
 */
const BASE = "/api/v1";

export interface GatewayRequest {
	signal?: AbortSignal;
	csrf?: () => string | undefined;
	/** `FetchLike`, not the ambient `fetch`: a caller must only supply what is actually called. */
	fetch?: FetchLike;
	/**
	 * How to read a successful body that is not JSON. Transcription is the case: `text`, `srt` and
	 * `vtt` are the file a caller would save, and parsing them as JSON would only lose them.
	 */
	parse?: (body: string, contentType: string | null) => unknown;
}

function headersFor(
	options: GatewayRequest,
	extra: Record<string, string> = {},
): Headers {
	const headers = new Headers({ accept: "application/json", ...extra });
	const token = (options.csrf ?? csrfTokenFromDocument)();
	if (token) headers.set("x-csrf-token", token);
	return headers;
}

/**
 * The gateway's failures are an envelope, not a status code alone: `{ error: { message } }` carries
 * the sentence an operator can act on, and losing it for "Request failed with 400" is what makes a
 * playground useless for debugging a deployment.
 */
async function answer<T>(
	response: Response,
	options: GatewayRequest = {},
): Promise<T> {
	const text = await response.text();
	let body: unknown;
	try {
		body = text ? JSON.parse(text) : undefined;
	} catch {
		body = undefined;
	}
	if (!response.ok) {
		const message =
			typeof body === "object" &&
			body !== null &&
			"error" in body &&
			typeof body.error === "object" &&
			body.error !== null &&
			"message" in body.error &&
			typeof body.error.message === "string"
				? body.error.message
				: `The gateway answered ${response.status}.`;
		throw new Error(message);
	}
	if (options.parse)
		return options.parse(text, response.headers.get("content-type")) as T;
	if (body === undefined) throw new Error("The gateway returned no answer.");
	return body as T;
}

export async function gatewayJson<T>(
	path: string,
	body: unknown,
	options: GatewayRequest = {},
): Promise<T> {
	const response = await (options.fetch ?? fetch)(`${BASE}${path}`, {
		method: "POST",
		credentials: "include",
		headers: headersFor(options, { "content-type": "application/json" }),
		body: JSON.stringify(body),
		...(options.signal ? { signal: options.signal } : {}),
	});
	return answer<T>(response, options);
}

/** Multipart, for the operations that carry a file: image edits and transcription. */
export async function gatewayForm<T>(
	path: string,
	form: FormData,
	options: GatewayRequest = {},
): Promise<T> {
	const response = await (options.fetch ?? fetch)(`${BASE}${path}`, {
		method: "POST",
		credentials: "include",
		// No content-type: the browser adds it with the multipart boundary.
		headers: headersFor(options),
		body: form,
		...(options.signal ? { signal: options.signal } : {}),
	});
	return answer<T>(response, options);
}
