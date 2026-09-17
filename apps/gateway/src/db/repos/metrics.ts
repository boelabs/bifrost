import { callTypeForOperation } from "#operations/registry.ts";
import type { metricsQuery } from "#admin/metricsSchema.ts";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { cacheMetrics } from "./cacheMetrics.ts";
import { db } from "#db/client.ts";
import type * as z from "zod/v4";

import {
	gatewayOperations as operations,
	upstreamAttempts as attempts,
} from "#db/schema.ts";

function tokenMetrics(table: typeof operations | typeof attempts) {
	return {
		promptTokens: sql<number | null>`sum(${table.promptTokens})::float8`,
		completionTokens: sql<
			number | null
		>`sum(${table.completionTokens})::float8`,
		reasoningTokens: sql<number | null>`sum(${table.reasoningTokens})::float8`,
		...cacheMetrics(table),
		totalTokens: sql<number>`coalesce(sum(${table.totalTokens}), 0)::float8`,
		searchUnits: sql<number | null>`sum(${table.searchUnits})::float8`,
		usageReported: sql<number>`count(${table.totalTokens})::float8`,
	};
}

export async function aggregateMetrics(filter: z.infer<typeof metricsQuery>) {
	const start = new Date(filter.start);
	const end = new Date(filter.end);
	const requestConditions = [
		gte(operations.startedAt, start),
		lt(operations.startedAt, end),
	];
	if (filter.publicModel)
		requestConditions.push(eq(operations.publicModel, filter.publicModel));
	if (filter.operation) {
		const callType = callTypeForOperation(filter.operation);
		if (callType) requestConditions.push(eq(operations.callType, callType));
	}
	if (filter.deploymentId)
		requestConditions.push(
			sql`exists (select 1 from ${attempts} selected where selected.operation_id = ${operations.id} and selected.deployment_id = ${filter.deploymentId})`,
		);
	const requestWhere = and(...requestConditions);
	const attemptWhere = and(
		...requestConditions,
		filter.deploymentId
			? eq(attempts.deploymentId, filter.deploymentId)
			: undefined,
	);
	// Anchor both series to the same request-start cohort; retries never duplicate request totals.
	const bucket =
		sql<string>`to_char(date_bin(${filter.bucket === "hour" ? "1 hour" : "1 day"}::interval, ${operations.startedAt}, ${start.toISOString()}::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`.as(
			"bucket",
		);
	const requestFields = {
		...tokenMetrics(operations),
		requests: sql<number>`count(*)::float8`,
		finished: sql<number>`count(*) filter (where ${operations.lifecycleState} = 'finished')::float8`,
		success: sql<number>`count(*) filter (where ${operations.outcome} = 'success')::float8`,
		errors: sql<number>`count(*) filter (where ${operations.outcome} = 'error')::float8`,
		incomplete: sql<number>`count(*) filter (where ${operations.outcome} = 'incomplete')::float8`,
		blocked: sql<number>`count(*) filter (where ${operations.outcome} = 'blocked')::float8`,
		cancelled: sql<number>`count(*) filter (where ${operations.outcome} = 'cancelled')::float8`,
		abandoned: sql<number>`count(*) filter (where ${operations.outcome} = 'abandoned')::float8`,
		unknown: sql<number>`count(*) filter (where ${operations.outcome} = 'unknown')::float8`,
		degraded: sql<number>`count(*) filter (where ${operations.degraded})::float8`,
		cacheHits: sql<number>`count(*) filter (where ${operations.cacheHit})::float8`,
		consumerCostCents: sql<number>`coalesce(sum(${operations.consumerCostCents}), 0)::float8`,
		upstreamCostCents: sql<number>`coalesce(sum(${operations.upstreamCostCents}), 0)::float8`,
		p50DurationMs: sql<
			number | null
		>`percentile_cont(0.5) within group (order by ${operations.durationMs})`,
		p95DurationMs: sql<
			number | null
		>`percentile_cont(0.95) within group (order by ${operations.durationMs})`,
		p95FirstOutputMs: sql<
			number | null
		>`percentile_cont(0.95) within group (order by ${operations.firstOutputMs})`,
	};
	const attemptFields = {
		...tokenMetrics(attempts),
		attempts: sql<number>`count(*)::float8`,
		finished: sql<number>`count(*) filter (where ${attempts.endedAt} is not null)::float8`,
		errors: sql<number>`count(*) filter (where ${attempts.outcome} = 'error')::float8`,
		success: sql<number>`count(*) filter (where ${attempts.outcome} = 'success')::float8`,
		p95DurationMs: sql<
			number | null
		>`percentile_cont(0.95) within group (order by ${attempts.durationMs})`,
	};
	return db.transaction(
		async (tx) => {
			const [
				requests,
				upstream,
				series,
				attemptSeries,
				models,
				deployments,
				failures,
			] = await Promise.all([
				tx.select(requestFields).from(operations).where(requestWhere),
				tx
					.select(attemptFields)
					.from(attempts)
					.innerJoin(operations, eq(attempts.operationId, operations.id))
					.where(attemptWhere),
				tx
					.select({ key: bucket, ...requestFields })
					.from(operations)
					.where(requestWhere)
					.groupBy(sql`"bucket"`)
					.orderBy(sql`"bucket"`),
				tx
					.select({ key: bucket, ...attemptFields })
					.from(attempts)
					.innerJoin(operations, eq(attempts.operationId, operations.id))
					.where(attemptWhere)
					.groupBy(sql`"bucket"`)
					.orderBy(sql`"bucket"`),
				tx
					.select({ key: operations.publicModel, ...requestFields })
					.from(operations)
					.where(requestWhere)
					.groupBy(operations.publicModel)
					.orderBy(operations.publicModel),
				tx
					.select({
						key: attempts.deploymentId,
						label: sql<string | null>`max(${attempts.deploymentLabel})`,
						adapter: sql<string | null>`max(${attempts.adapterKey})`,
						...attemptFields,
					})
					.from(attempts)
					.innerJoin(operations, eq(attempts.operationId, operations.id))
					.where(attemptWhere)
					.groupBy(attempts.deploymentId)
					.orderBy(attempts.deploymentId),
				tx
					.select({
						deploymentId: attempts.deploymentId,
						label: sql<string | null>`max(${attempts.deploymentLabel})`,
						kind: attempts.failureKind,
						phase: attempts.failurePhase,
						status: attempts.providerStatus,
						count: sql<number>`count(*)::float8`,
					})
					.from(attempts)
					.innerJoin(operations, eq(attempts.operationId, operations.id))
					.where(and(attemptWhere, eq(attempts.outcome, "error")))
					.groupBy(
						attempts.deploymentId,
						attempts.failureKind,
						attempts.failurePhase,
						attempts.providerStatus,
					),
			]);
			return {
				start: start.toISOString(),
				end: end.toISOString(),
				bucket: filter.bucket,
				requests: requests[0]!,
				attempts: upstream[0]!,
				series,
				attemptSeries,
				models,
				deployments,
				failures,
			};
		},
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}
