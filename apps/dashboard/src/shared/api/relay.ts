import { gatewayUrl } from "#/shared/config/server.ts";

/**
 * Forwards a browser request to the gateway and hands its answer straight back.
 *
 * The browser never leaves this origin: it talks to the dashboard, and the dashboard talks to the
 * gateway. That is what removes CORS, `SameSite=None` and the need for the gateway to be public.
 *
 * Only the headers a gateway request actually needs are forwarded. `cookie` carries the operator's
 * session, `x-csrf-token` the double-submit value the gateway demands on every mutation, and
 * `range` the byte window a media element asks for when it seeks.
 */
const FORWARDED = ["accept", "content-type", "cookie", "range", "x-csrf-token"];

/**
 * What the answer is allowed to carry back. The media headers matter as much as `content-type`:
 * without `accept-ranges` and `content-range` a `<video>` can play a generated file but cannot seek
 * inside it, and without `content-length` it cannot show how long the file is.
 */
const RETURNED = [
	"content-type",
	"content-length",
	"content-range",
	"accept-ranges",
	"content-disposition",
	"cache-control",
	"last-modified",
	"etag",
	"retry-after",
];

export async function relay(request: Request, path: string): Promise<Response> {
	const headers = new Headers();
	for (const name of FORWARDED) {
		const value = request.headers.get(name);
		if (value) {
			headers.set(name, value);
		}
	}

	let upstream: Response;
	try {
		// The query string belongs to the gateway too — `?variant=` and `?limit=` are how several of
		// its endpoints are asked a question at all — and the caller only ever knows the path.
		upstream = await fetch(
			gatewayUrl(`${path}${new URL(request.url).search}`),
			{
				method: request.method,
				headers,
				body: request.body,
				// Required by fetch whenever a body is a stream.
				...(request.body ? { duplex: "half" } : {}),
				redirect: "manual",
				cache: "no-store",
			},
		);
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
	for (const name of RETURNED) {
		const value = upstream.headers.get(name);
		if (value) {
			response.headers.set(name, value);
		}
	}
	/**
	 * The gateway sets its cookies without a `Domain`, so re-emitting them verbatim scopes them to
	 * this dashboard's host — which is exactly where they are wanted now.
	 */
	for (const cookie of upstream.headers.getSetCookie()) {
		response.headers.append("set-cookie", cookie);
	}
	return response;
}
