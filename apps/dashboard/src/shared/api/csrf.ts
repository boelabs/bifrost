/**
 * The session cookie is httpOnly, so nothing on the page ever sees it — the browser attaches it. What
 * a caller must do is prove the request came from here, by echoing the readable CSRF cookie in a
 * header. The gateway requires this on every cookie-authenticated mutation, on `/admin` and `/v1`
 * alike.
 *
 * Both sides need the names: the server reads the cookie out of `next/headers` before calling the
 * gateway, and the playground's streaming fetch reads it out of `document.cookie` in the browser.
 * They live here so neither has to import the other's module.
 */
export const CSRF_COOKIE = "bifrost_csrf";
export const CSRF_HEADER = "x-csrf-token";

/** Methods the gateway treats as side-effect free, and therefore exempt from the CSRF header. */
export const SAFE_METHODS: ReadonlySet<string> = new Set([
	"GET",
	"HEAD",
	"OPTIONS",
]);

/** The CSRF token as the browser sees it. Undefined off the browser, where there is no document. */
export function csrfTokenFromDocument(): string | undefined {
	if (typeof document === "undefined") {
		return undefined;
	}
	for (const part of document.cookie.split(";")) {
		const [key, ...rest] = part.trim().split("=");
		if (key === CSRF_COOKIE) {
			return decodeURIComponent(rest.join("="));
		}
	}
	return undefined;
}
