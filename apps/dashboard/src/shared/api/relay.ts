import { gatewayUrl } from "#/shared/config/server.ts";

/**
 * Forwards a browser request to the gateway and hands its answer straight back.
 *
 * The browser never leaves this origin: it talks to the dashboard, and the dashboard talks to the
 * gateway. That is what removes CORS, `SameSite=None` and the need for the gateway to be public.
 *
 * Only the headers a gateway request actually needs are forwarded. `cookie` carries the operator's
 * session, `x-csrf-token` the double-submit value the gateway demands on every mutation.
 */
const FORWARDED = ["accept", "content-type", "cookie", "x-csrf-token"];

export async function relay(request: Request, path: string): Promise<Response> {
	const headers = new Headers();
	for (const name of FORWARDED) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}

	let upstream: Response;
	try {
		upstream = await fetch(gatewayUrl(path), {
			method: request.method,
			headers,
			body: request.body,
			// Required by fetch whenever a body is a stream.
			...(request.body ? { duplex: "half" } : {}),
			redirect: "manual",
			cache: "no-store",
		});
	} catch {
		// An unreachable gateway is this dashboard's problem to report, not an opaque 500: the
		// caller is our own page, and it renders the message.
		return Response.json(
			{
				error: { message: "The gateway is not reachable from the dashboard." },
			},
			{ status: 502 },
		);
	}

	// The body is passed through unread so a token-by-token inference stream stays a stream.
	const response = new Response(upstream.body, {
		status: upstream.status,
		statusText: upstream.statusText,
	});
	for (const name of ["content-type", "cache-control", "retry-after"]) {
		const value = upstream.headers.get(name);
		if (value) response.headers.set(name, value);
	}
	/**
	 * The gateway sets its cookies without a `Domain`, so re-emitting them verbatim scopes them to
	 * this dashboard's host — which is exactly where they are wanted now.
	 */
	for (const cookie of upstream.headers.getSetCookie())
		response.headers.append("set-cookie", cookie);
	return response;
}
