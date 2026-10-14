import { fallbackPolicies, routerSettings } from "#db/schema.ts";
import { invalidateRoutingConfig } from "./deployments.ts";
import { writtenRow } from "#db/returning.ts";
import { and, eq } from "drizzle-orm";
import { db } from "#db/client.ts";

import {
	normalizeExecutionPolicies,
	storableExecutionPolicies,
	type ExecutionPolicies,
} from "#core/executionPolicy.ts";

export type RouterSettingsRow = typeof routerSettings.$inferSelect;

/** The settings as the admin API reports them: current policy shape, retired columns omitted. */
export type RouterSettingsView = Omit<
	RouterSettingsRow,
	| "executionPolicies"
	| "adaptiveTimeoutsEnabled"
	| "adaptiveTimeoutMultiplier"
	| "adaptiveTimeoutFloorMs"
> & { executionPolicies: ExecutionPolicies };

export function routerSettingsView(row: RouterSettingsRow): RouterSettingsView {
	const {
		adaptiveTimeoutsEnabled: _enabled,
		adaptiveTimeoutMultiplier: _multiplier,
		adaptiveTimeoutFloorMs: _floor,
		executionPolicies,
		...rest
	} = row;
	return {
		...rest,
		executionPolicies: normalizeExecutionPolicies(executionPolicies),
	};
}
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

export interface RouterSettingsPatch {
	routingStrategy?: RouterSettingsRow["routingStrategy"] | undefined;
	unsupportedParameterStrategy?:
		| RouterSettingsRow["unsupportedParameterStrategy"]
		| undefined;
	allowedFails?: number | undefined;
	allowedFailsByClass?: RouterSettingsRow["allowedFailsByClass"] | undefined;
	failureRatePercent?: number | undefined;
	minWindowRequests?: number | undefined;
	protectLastDeployment?: boolean | undefined;
	cooldownSeconds?: number | undefined;
	failureWindowSeconds?: number | undefined;
	maxCooldownSeconds?: number | undefined;
	halfOpenProbeSeconds?: number | undefined;
	configurationCooldownSeconds?: number | undefined;
	throttleCooldownSeconds?: number | undefined;
	executionPolicies?: ExecutionPolicies | undefined;
	retryAfterSeconds?: number | undefined;
}

export async function updateRouterSettings(
	patch: RouterSettingsPatch,
): Promise<RouterSettingsRow> {
	const { executionPolicies, ...rest } = patch;
	const [row] = await db
		.update(routerSettings)
		.set({
			...rest,
			...(executionPolicies === undefined
				? {}
				: { executionPolicies: storableExecutionPolicies(executionPolicies) }),
			updatedAt: new Date(),
		})
		.where(eq(routerSettings.id, 1))
		.returning();
	return writtenRow(row, "updateRouterSettings");
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
	invalidateRoutingConfig();
	return writtenRow(row, "upsertFallbackPolicy");
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
	invalidateRoutingConfig();
}
