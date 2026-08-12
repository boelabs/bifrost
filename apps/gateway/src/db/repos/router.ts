import { fallbackPolicies, routerSettings } from "#db/schema.ts";
import { and, eq } from "drizzle-orm";
import { db } from "#db/client.ts";

export type RouterSettingsRow = typeof routerSettings.$inferSelect;
export type FallbackPolicyRow = typeof fallbackPolicies.$inferSelect;
export type FallbackReason = FallbackPolicyRow["reason"];

/** Singleton of the router's global configuration (id = 1). */
export async function getRouterSettings(): Promise<
	RouterSettingsRow | undefined
> {
	const [row] = await db
		.select()
		.from(routerSettings)
		.where(eq(routerSettings.id, 1))
		.limit(1);
	return row;
}

/** Dedicated fallback policy for (primaryModel, reason). */
export async function getFallbackPolicy(
	primaryModel: string,
	reason: FallbackReason,
): Promise<FallbackPolicyRow | undefined> {
	const [row] = await db
		.select()
		.from(fallbackPolicies)
		.where(
			and(
				eq(fallbackPolicies.primaryModel, primaryModel),
				eq(fallbackPolicies.reason, reason),
			),
		)
		.limit(1);
	return row;
}

export interface RouterSettingsPatch {
	routingStrategy?: RouterSettingsRow["routingStrategy"] | undefined;
	unsupportedParameterStrategy?:
		| RouterSettingsRow["unsupportedParameterStrategy"]
		| undefined;
	allowedFails?: number | undefined;
	cooldownSeconds?: number | undefined;
	failureWindowSeconds?: number | undefined;
	maxCooldownSeconds?: number | undefined;
	halfOpenProbeSeconds?: number | undefined;
	configurationCooldownSeconds?: number | undefined;
	throttleCooldownSeconds?: number | undefined;
	executionPolicies?: RouterSettingsRow["executionPolicies"] | undefined;
	retryAfterSeconds?: number | undefined;
}

export async function updateRouterSettings(
	patch: RouterSettingsPatch,
): Promise<RouterSettingsRow> {
	const [row] = await db
		.update(routerSettings)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(routerSettings.id, 1))
		.returning();
	return row!;
}

export async function listFallbackPolicies(): Promise<FallbackPolicyRow[]> {
	return db.select().from(fallbackPolicies);
}

export interface UpsertFallbackPolicyInput {
	primaryModel: string;
	fallbackModels: string[];
	reason?: FallbackReason;
}

export async function upsertFallbackPolicy(
	input: UpsertFallbackPolicyInput,
): Promise<FallbackPolicyRow> {
	const reason = input.reason ?? "general";
	const [row] = await db
		.insert(fallbackPolicies)
		.values({
			primaryModel: input.primaryModel,
			fallbackModels: input.fallbackModels,
			reason,
		})
		.onConflictDoUpdate({
			target: [fallbackPolicies.primaryModel, fallbackPolicies.reason],
			set: { fallbackModels: input.fallbackModels },
		})
		.returning();
	return row!;
}

export async function deleteFallbackPolicy(
	primaryModel: string,
	reason: FallbackReason,
): Promise<void> {
	await db
		.delete(fallbackPolicies)
		.where(
			and(
				eq(fallbackPolicies.primaryModel, primaryModel),
				eq(fallbackPolicies.reason, reason),
			),
		);
}
