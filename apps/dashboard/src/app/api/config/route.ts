import { assertConfigured } from "#/shared/config/server.ts";
import { connection } from "next/server";

/**
 * The dashboard's own health signal, and the endpoint its container healthcheck hits.
 *
 * It answers 200 iff this server is up AND knows where the gateway is. It deliberately does not
 * call the gateway: a gateway outage is the gateway's health to report, and a dashboard that marked
 * itself unhealthy for it would be restarted by the platform for someone else's problem.
 *
 * Content-free on purpose — it is unauthenticated (see the `PUBLIC` list in `proxy.ts`), because a
 * health check arrives without a session and a redirect to the login screen would make the check
 * pass by rendering a page rather than by proving anything.
 */
export async function GET(): Promise<Response> {
	// Reading the environment and the clock: this answer is per-request, never prerendered.
	await connection();
	try {
		assertConfigured();
	} catch (error) {
		return Response.json(
			{
				status: "misconfigured",
				service: "Bifrost dashboard",
				error: error instanceof Error ? error.message : String(error),
				time: new Date().toISOString(),
			},
			{ status: 503, headers: { "cache-control": "no-store" } },
		);
	}
	return Response.json(
		{
			status: "ok",
			service: "Bifrost dashboard",
			time: new Date().toISOString(),
		},
		{ headers: { "cache-control": "no-store" } },
	);
}
