import { CSRF_HEADER, CSRF_COOKIE, SAFE_METHODS } from "./csrf.ts";
import { gatewayUrl } from "#/shared/config/server.ts";
import createClient from "openapi-fetch";
import { cookies } from "next/headers";
import type { paths } from "./schema";

/**
 * Typed client for the gateway, server-side only: it reads cookies through `next/headers`, so
 * importing it from a `"use client"` module is a build error. `paths` is generated from
 * `apps/gateway/openapi.yaml`.
 */

/**
 * An origin that cannot resolve, replaced on the way out by `resolve` below.
 *
 * openapi-fetch builds the `Request` — and so needs an absolute URL — before our `fetch` runs, but
 * the gateway's address must not be read until after `cookies()` has marked the render dynamic, or
 * `next build` could not prerender a route without a configured gateway.
 */
const UNRESOLVED = "http://gateway.invalid";

function resolve(request: Request): Request {
	const { pathname, search } = new URL(request.url);
	return new Request(gatewayUrl(`${pathname}${search}`), request);
}

/**
 * Relays the visitor's session, so a feature cannot forget that a server-side call still acts on
 * behalf of a person.
 *
 * A custom `fetch` rather than openapi-fetch middleware: a registered middleware makes the client
 * mint a `Math.random()` request id before it runs, and that unseeded value fails the prerender of
 * the route's shell before the `cookies()` read below marks the render dynamic.
 */
async function withSession(request: Request): Promise<Response> {
	const jar = await cookies();
	const headers = new Headers(request.headers);
	const cookie = jar.toString();
	if (cookie) headers.set("cookie", cookie);
	if (!SAFE_METHODS.has(request.method)) {
		const token = jar.get(CSRF_COOKIE)?.value;
		if (token) headers.set(CSRF_HEADER, token);
	}
	return fetch(resolve(new Request(request, { headers })));
}

export const api = createClient<paths>({
	baseUrl: UNRESOLVED,
	fetch: withSession,
});

/**
 * `GET /v1/models` is unauthenticated and answers identically for everyone. Keeping it off the
 * session client is what lets the playground's model list be cached: a `'use cache'` scope may not
 * read cookies.
 */
export const publicApi = createClient<paths>({
	baseUrl: UNRESOLVED,
	fetch: (request) => fetch(resolve(request)),
});

export {
	type GatewayErrorBody,
	isUnauthenticated,
	ApiError,
	unwrap,
} from "./errors.ts";
