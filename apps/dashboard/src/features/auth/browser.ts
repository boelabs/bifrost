import { CSRF_HEADER, csrfTokenFromDocument } from "#/shared/api/csrf.ts";
import { ApiError, type GatewayErrorBody } from "#/shared/api/errors.ts";
import type { OperatorIdentity } from "./common.ts";

/**
 * Sign-in and sign-out, from the browser.
 *
 * Every other mutation in the dashboard is a Server Action, but these two are the exception on
 * purpose: the gateway answers them with `Set-Cookie`, and the session cookie is httpOnly, so it has
 * to be the browser's own request that receives it. Relaying it through a Server Action would mean
 * parsing the gateway's cookie and re-emitting it under our own name — inventing a second session
 * format for no gain, and getting the flags wrong sooner or later.
 *
 * They go to this app's own `/api/auth/session`, which relays to the gateway and passes its
 * `Set-Cookie` back (`app/api/auth/session/route.ts`). The browser never leaves this origin, so the
 * cookie is same-site and there is no CORS anywhere.
 */

const SESSION = "/api/auth/session";

async function post(path: string, body?: unknown): Promise<Response> {
	const headers = new Headers({ "content-type": "application/json" });
	const token = csrfTokenFromDocument();
	if (token) headers.set(CSRF_HEADER, token);
	return fetch(path, {
		method: "POST",
		headers,
		credentials: "include",
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

async function failure(response: Response): Promise<ApiError> {
	const body = (await response
		.json()
		.catch(() => null)) as Partial<GatewayErrorBody> | null;
	return new ApiError(
		body?.error?.message ?? `Request failed with status ${response.status}`,
		{ status: response.status, code: body?.error?.code ?? null },
	);
}

export async function login(
	username: string,
	password: string,
): Promise<OperatorIdentity> {
	const response = await post(SESSION, { username, password });
	if (!response.ok) throw await failure(response);
	return ((await response.json()) as { data: OperatorIdentity }).data;
}

export async function logout(): Promise<void> {
	const headers = new Headers();
	const token = csrfTokenFromDocument();
	if (token) headers.set(CSRF_HEADER, token);
	const response = await fetch(SESSION, {
		method: "DELETE",
		headers,
		credentials: "include",
	});
	// A session that is already gone is the state the caller wanted; only a real failure is news.
	if (!response.ok && response.status !== 401) throw await failure(response);
}
