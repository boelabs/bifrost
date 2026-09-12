import { gatewayUrl } from "#/shared/config/server.ts";
import * as z from "zod/v4";

/**
 * Readiness is the one thing the dashboard could never tell an operator: the gateway answers
 * `/health/ready` with the state of Postgres, Redis, the extension runtime and operation
 * persistence, and until now that answer only ever reached a load balancer.
 *
 * A 503 is a valid, informative answer here rather than an error — it is exactly the case worth
 * showing — so the status code is read, not thrown on.
 */
const readinessSchema = z.object({
	status: z.string(),
	dependencies: z.object({ database: z.boolean(), cache: z.boolean() }),
	observability: z
		.object({ healthy: z.boolean(), reason: z.string().nullish() })
		.loose()
		.optional(),
	extensions: z
		.object({
			status: z.string(),
			healthy: z.boolean(),
			definitions: z.number(),
			instances: z.object({
				total: z.number(),
				active: z.number(),
				disabled: z.number(),
			}),
		})
		.optional(),
	time: z.string(),
});

export type Readiness = z.infer<typeof readinessSchema>;

export async function readiness(): Promise<Readiness | null> {
	try {
		const response = await fetch(gatewayUrl("/health/ready"), {
			headers: { accept: "application/json" },
		});
		return readinessSchema.parse(await response.json());
	} catch {
		// Unreachable or unparseable: the page says "unknown" rather than failing the whole overview.
		return null;
	}
}
