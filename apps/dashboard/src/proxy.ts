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

/** `/api/auth` is the sign-in relay itself; gating it would make signing in require a session. */
const PUBLIC = ["/auth", "/api/auth"];

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
	 * Everything except Next's own assets: a redirect served for a stylesheet is a broken page, not
	 * a login prompt. `"/"` is listed separately because the pattern below needs at least one
	 * character after the slash, and without it the overview is the one route with no gate.
	 */
	matcher: ["/", "/((?!_next/static|_next/image|fonts/|favicon.ico).*)"],
};
