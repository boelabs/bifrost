/**
 * Runs once, before the server accepts its first request.
 *
 * Next calls `register` in every runtime, including Edge, where `process.exit` does not exist — so
 * the check itself is a separate module pulled in by a conditional dynamic import. That is the
 * documented shape for runtime-specific start-up code, and it keeps the Node-only call out of the
 * Edge bundle entirely rather than merely unreachable.
 */
export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME === "nodejs") {
		await import("./instrumentation-node.ts");
	}
}
