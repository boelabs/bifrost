/**
 * Where the gateway is.
 *
 * One address, because this process is the only thing that talks to the gateway — the browser never
 * leaves the dashboard's own origin. The gateway therefore need not be reachable from the internet
 * at all, and there is no CORS or cross-site cookie policy to keep in step.
 *
 * Read on every call, never at module scope: a value captured when this module is first evaluated
 * can be captured during a prerender and baked into the build.
 */
export function gatewayUrl(path = ""): string {
	const raw = process.env.GATEWAY_URL?.trim();
	if (!raw) {
		throw new Error(
			"GATEWAY_URL is not set.\n" +
				"\n" +
				"  GATEWAY_URL   where the gateway is, e.g. https://gateway.example.com, or\n" +
				"                http://gateway:4000 on a private network. Only this process\n" +
				"                needs to reach it.\n" +
				"\n" +
				"Locally: cp .env.example .env\n",
		);
	}
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch (cause) {
		throw new Error(`GATEWAY_URL must be an absolute URL, got: ${raw}`, {
			cause,
		});
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(
			`GATEWAY_URL must be http or https, got: ${parsed.protocol}`,
		);
	}
	// A trailing slash makes every `${base}${path}` produce a double slash.
	return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}${path}`;
}

/** Called from `instrumentation.ts` so a missing address fails the boot, not the first page. */
export function assertConfigured(): void {
	gatewayUrl();
}
