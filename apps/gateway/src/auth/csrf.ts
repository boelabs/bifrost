import { GatewayError } from "#core/errors.ts";
import { timingSafeEqual } from "node:crypto";

/** Methods that cannot change state, and therefore need no CSRF proof. */
const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a, "utf8");
	const right = Buffer.from(b, "utf8");
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}

/**
 * Double-submit CSRF check for cookie-borne credentials.
 *
 * The rule is by CREDENTIAL SOURCE, not by route: a browser attaches cookies to cross-site requests
 * on its own, so a state-changing call authenticated by one must prove it came from our own page —
 * on /admin and on /v1 alike, because inference costs real money. Header credentials (Bearer,
 * x-api-key) are never attached automatically and are exempt, which is what keeps every existing SDK
 * client working untouched.
 */
export function assertCsrfToken(
	method: string,
	cookieToken: string | undefined,
	headerToken: string | undefined,
): void {
	if (SAFE_METHODS.includes(method.toUpperCase())) return;
	if (cookieToken && headerToken && safeEqual(cookieToken, headerToken)) return;
	throw new GatewayError({
		class: "permission",
		code: "csrf_token_invalid",
		message:
			"Missing or mismatched CSRF token on a cookie-authenticated request",
		publicMessage: "Missing or invalid CSRF token.",
	});
}
