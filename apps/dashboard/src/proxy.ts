import { type NextRequest, NextResponse } from "next/server";
import { gatewayUrl } from "#/shared/config/server.ts";

/**
 * Turns "no session" into a real redirect, before any route renders. Once the shell has streamed, a
 * `redirect()` from inside it can only be applied by the client router, which leaves the operator
 * watching a skeleton resolve into a navigation.
 *
 * A cookie on its own proves nothing — it may be expired or revoked — so a cookie on a document
 * request is checked against the gateway. This must never redirect anyone *away* from the login
 * screen on the strength of one: that locks out exactly the people who need it.
 */
const SESSION_COOKIE = "bifrost_session";

/**
 * `/api/auth` is the sign-in relay itself; gating it would make signing in require a session.
 * `/api/config` is the container healthcheck, which arrives without one — gated, it would answer
 * every probe with a redirect to the login page and report the dashboard healthy for the wrong
 * reason.
 */
const PUBLIC = ["/auth", "/api/auth", "/api/config"];

/**
 * True only when the gateway actively rejects the session. An unreachable gateway is not a
 * signed-out operator: redirecting on it would send them to a login screen that cannot work either.
 */
async function sessionRejected(cookie: string): Promise<boolean> {
	try {
		const response = await fetch(gatewayUrl("/auth/session"), {
			headers: { cookie, accept: "application/json" },
			cache: "no-store",
		});
		return response.status === 401 || response.status === 403;
	} catch {
		return false;
	}
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
	const { pathname, search } = request.nextUrl;
	if (
		PUBLIC.some((path) => pathname === path || pathname.startsWith(`${path}/`))
	)
		return NextResponse.next();

	const cookie = request.headers.get("cookie");
	const hasSessionCookie = request.cookies.has(SESSION_COOKIE);
	/**
	 * Only a document load has to be decided up front; an RSC request is a navigation or a prefetch
	 * inside an app that is already open, and can apply a streamed redirect. Told apart by `Accept`
	 * because Next strips the `RSC` header before this runs.
	 */
	const isDocument = (request.headers.get("accept") ?? "").includes(
		"text/html",
	);

	if (
		hasSessionCookie &&
		(!isDocument || !cookie || !(await sessionRejected(cookie)))
	)
		return NextResponse.next();

	const url = request.nextUrl.clone();
	url.pathname = "/auth";
	url.search = "";
	if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);

	const response = NextResponse.redirect(url);
	// The gateway has stopped honouring this cookie; dropping it means the next request never asks.
	if (hasSessionCookie) response.cookies.delete(SESSION_COOKIE);
	return response;
}

export const config = {
	/**
	 * The session gates application routes. It does not gate assets or site metadata.
	 *
	 * A redirect served for a stylesheet is a broken page rather than a login prompt — and for
	 * `robots.txt` it is worse than that: a crawler follows it to the sign-in screen and never reads
	 * the `Disallow` that was the whole point of publishing one. The manifest is the same story from
	 * the other side, because a browser fetches `<link rel="manifest">` without credentials, so a
	 * gated manifest is broken even for an operator who is signed in.
	 *
	 * Hence the second clause: a root-level path with a file extension. Every route this app
	 * actually serves is a bare path (`/keys`, `/api/v1/…`), so the two sets do not overlap, and a
	 * metadata file convention added later — an `opengraph-image.png`, a `sitemap.xml` — is public
	 * the day it appears instead of silently redirecting. `fonts/` stays listed because it carries a
	 * slash and this clause deliberately does not reach into directories.
	 *
	 * `"/"` is listed separately because the pattern needs at least one character after the slash,
	 * and without it the overview is the one route with no gate.
	 */
	matcher: ["/", "/((?!_next/static|_next/image|fonts/|[^/]+[.][a-z0-9]+$).*)"],
};
