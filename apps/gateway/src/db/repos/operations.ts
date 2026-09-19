import { and, count, desc, eq, gte, lt, lte, sql, type SQL } from "drizzle-orm";
import type { Page, PageResult } from "./deployments.ts";
import type { PgColumn } from "drizzle-orm/pg-core";
import { cacheMetrics } from "./cacheMetrics.ts";
import { db } from "#db/client.ts";

import {
	gatewayOperations,
	upstreamAttempts,
	payloadSamples,
} from "#db/schema.ts";

export type GatewayOperationRow = typeof gatewayOperations.$inferSelect;

export interface OperationFilter {
	virtualKeyId?: string;
	actor?: string;
	publicModel?: string;
	deploymentId?: string;
	adapterKey?: string;
	callType?: string;
	requestId?: string;
	outcome?: GatewayOperationRow["outcome"];
	degraded?: boolean;
	active?: boolean;
	terminalVerified?: boolean;
	cacheHit?: boolean;
	failureKind?: string;
	failurePhase?: string;
	minDurationMs?: number;
	maxDurationMs?: number;
	start?: Date;
	end?: Date;
}

function conditions(filter: OperationFilter): SQL[] {
	const result: SQL[] = [];
	if (filter.virtualKeyId) {
		result.push(eq(gatewayOperations.virtualKeyId, filter.virtualKeyId));
	}
	if (filter.actor) {
		result.push(eq(gatewayOperations.actor, filter.actor));
	}
	if (filter.publicModel) {
		result.push(eq(gatewayOperations.publicModel, filter.publicModel));
	}
	if (filter.deploymentId) {
		result.push(
			sql`exists (select 1 from ${upstreamAttempts} a where a.operation_id = ${gatewayOperations.id} and a.deployment_id = ${filter.deploymentId})`,
		);
	}
	if (filter.adapterKey) {
		result.push(
			sql`exists (select 1 from ${upstreamAttempts} a where a.operation_id = ${gatewayOperations.id} and a.adapter_key = ${filter.adapterKey})`,
		);
	}
	if (filter.callType) {
		result.push(eq(gatewayOperations.callType, filter.callType));
	}
	if (filter.requestId) {
		result.push(eq(gatewayOperations.requestId, filter.requestId));
	}
	if (filter.outcome) {
		result.push(eq(gatewayOperations.outcome, filter.outcome));
	}
	if (filter.degraded !== undefined) {
		result.push(eq(gatewayOperations.degraded, filter.degraded));
	}
	if (filter.active !== undefined) {
		result.push(
			eq(
				gatewayOperations.lifecycleState,
				filter.active ? "in_progress" : "finished",
			),
		);
	}
	if (filter.terminalVerified !== undefined) {
		result.push(
			eq(gatewayOperations.terminalVerified, filter.terminalVerified),
		);
	}
	if (filter.cacheHit !== undefined) {
		result.push(eq(gatewayOperations.cacheHit, filter.cacheHit));
	}
	if (filter.minDurationMs !== undefined) {
		result.push(gte(gatewayOperations.durationMs, filter.minDurationMs));
	}
	if (filter.maxDurationMs !== undefined) {
		result.push(lte(gatewayOperations.durationMs, filter.maxDurationMs));
	}
	if (filter.failureKind) {
		result.push(
			sql`exists (select 1 from ${upstreamAttempts} a where a.operation_id = ${gatewayOperations.id} and a.failure_kind = ${filter.failureKind})`,
		);
	}
	if (filter.failurePhase) {
		result.push(
			sql`exists (select 1 from ${upstreamAttempts} a where a.operation_id = ${gatewayOperations.id} and a.failure_phase = ${filter.failurePhase})`,
		);
	}
	if (filter.start) {
		result.push(gte(gatewayOperations.startedAt, filter.start));
	}
	if (filter.end) {
		result.push(lte(gatewayOperations.startedAt, filter.end));
	}
	return result;
}

export async function listOperationsPage(
	opts: Page & OperationFilter,
): Promise<PageResult<GatewayOperationRow>> {
	const conds = conditions(opts);
	const where = conds.length > 0 ? and(...conds) : undefined;
	const [rows, totalRow] = await Promise.all([
		db
			.select()
			.from(gatewayOperations)
			.where(where)
			.orderBy(desc(gatewayOperations.startedAt))
			.limit(opts.limit)
			.offset(opts.offset),
		db.select({ value: count() }).from(gatewayOperations).where(where),
	]);
	return { rows, total: Number(totalRow[0]?.value ?? 0) };
}

/**
 * One operation, its attempt timeline, and whether a retained sample still stands behind it.
 *
 * The sample is described, never returned: reading one is a separate, audited call. Describing it
 * here is what lets an operator be told "swept by retention" instead of being offered a button that
 * spends an audit entry to discover the same thing.
 */
export async function getOperationDetail(id: string) {
	return db.transaction(
		async (tx) => {
			const [operation] = await tx
				.select()
				.from(gatewayOperations)
				.where(eq(gatewayOperations.id, id))
				.limit(1);
			if (!operation) {
				return null;
			}
			// Sequential, not Promise.all: both statements share the transaction's single connection.
			const attempts = await tx
				.select()
				.from(upstreamAttempts)
				.where(eq(upstreamAttempts.operationId, id))
				.orderBy(upstreamAttempts.ordinal);
			const [sample] = await tx
				.select({
					captureReason: payloadSamples.captureReason,
					expiresAt: payloadSamples.expiresAt,
				})
				.from(payloadSamples)
				.where(eq(payloadSamples.operationId, id))
				.limit(1);
			const retained = sample !== undefined && sample.expiresAt > new Date();
			return {
				...operation,
				attempts,
				payload: {
					retained,
					captureReason: retained ? sample.captureReason : null,
					expiresAt: retained ? sample.expiresAt : null,
				},
			};
		},
		{
			isolationLevel: "repeatable read",
			accessMode: "read only",
		},
	);
}

/**
 * The overview's numbers for one window.
 *
 * `until` is optional because the common call is "the last N days, up to now"; an explicit end is
 * what lets the dashboard ask for a closed day ("yesterday") rather than only for trailing windows.
 * `active` deliberately ignores both bounds: an in-progress operation is a fact about right now, not
 * about the window being read.
 */
export async function operationSummary(since: Date, until?: Date) {
	const started = (column: PgColumn) =>
		until === undefined
			? gte(column, since)
			: and(gte(column, since), lt(column, until));
	const rows = await db
		.select({
			outcome: gatewayOperations.outcome,
			requests: count(),
			degraded: sql<number>`count(*) filter (where ${gatewayOperations.degraded})::int`,
			p50DurationMs: sql<
				number | null
			>`percentile_cont(0.50) within group (order by ${gatewayOperations.durationMs})`,
			p95DurationMs: sql<
				number | null
			>`percentile_cont(0.95) within group (order by ${gatewayOperations.durationMs})`,
			p99DurationMs: sql<
				number | null
			>`percentile_cont(0.99) within group (order by ${gatewayOperations.durationMs})`,
			p95FirstOutputMs: sql<
				number | null
			>`percentile_cont(0.95) within group (order by ${gatewayOperations.firstOutputMs})`,
		})
		.from(gatewayOperations)
		.where(started(gatewayOperations.startedAt))
		.groupBy(gatewayOperations.outcome);
	const [active] = await db
		.select({ value: count() })
		.from(gatewayOperations)
		.where(eq(gatewayOperations.lifecycleState, "in_progress"));
	const [totals, byModel, byAdapter, byDeployment, protocolErrorOperations] =
		await Promise.all([
			db
				.select({
					requests: count(),
					// The first-output clause is streaming-only by construction: a non-progressive
					// response stores null there, and null fails the comparison. That is the intent
					// - a non-streamed generation that legitimately ran long is not a stall, and the
					// attempt-level clause below still catches one that actually hung.
					stalls: sql<number>`count(*) filter (where ${gatewayOperations.firstOutputMs} > 30000 or ${gatewayOperations.maxInterEventGapMs} > 30000 or exists (select 1 from ${upstreamAttempts} a where a.operation_id = ${gatewayOperations.id} and a.failure_kind = 'timeout' and a.failure_phase = 'first_progress'))::int`,
					retried: sql<number>`count(*) filter (where exists (select 1 from ${upstreamAttempts} a where a.operation_id = ${gatewayOperations.id} and a.ordinal > 1))::int`,
					abandoned: sql<number>`count(*) filter (where ${gatewayOperations.outcome} = 'abandoned')::int`,
					degraded: sql<number>`count(*) filter (where ${gatewayOperations.degraded})::int`,
					cancelled: sql<number>`count(*) filter (where ${gatewayOperations.outcome} = 'cancelled')::int`,
					unverifiedTerminalOutcomes: sql<number>`count(*) filter (where ${gatewayOperations.outcome} in ('success', 'incomplete', 'blocked') and not ${gatewayOperations.terminalVerified})::int`,
					p95FirstOutputMs: sql<
						number | null
					>`percentile_cont(0.95) within group (order by ${gatewayOperations.firstOutputMs})`,
				})
				.from(gatewayOperations)
				.where(started(gatewayOperations.startedAt)),
			db
				.select({ key: gatewayOperations.publicModel, requests: count() })
				.from(gatewayOperations)
				.where(started(gatewayOperations.startedAt))
				.groupBy(gatewayOperations.publicModel),
			db
				.select({ key: upstreamAttempts.adapterKey, attempts: count() })
				.from(upstreamAttempts)
				.where(started(upstreamAttempts.startedAt))
				.groupBy(upstreamAttempts.adapterKey),
			db
				.select({ key: upstreamAttempts.deploymentId, attempts: count() })
				.from(upstreamAttempts)
				.where(started(upstreamAttempts.startedAt))
				.groupBy(upstreamAttempts.deploymentId),
			db
				.select({
					value: sql<number>`count(distinct ${upstreamAttempts.operationId})::int`,
				})
				.from(upstreamAttempts)
				.innerJoin(
					gatewayOperations,
					eq(upstreamAttempts.operationId, gatewayOperations.id),
				)
				.where(
					and(
						started(gatewayOperations.startedAt),
						eq(upstreamAttempts.failureKind, "protocol"),
					),
				),
		]);
	const totalMetrics = totals[0] ?? {
		requests: 0,
		stalls: 0,
		retried: 0,
		abandoned: 0,
		degraded: 0,
		cancelled: 0,
		unverifiedTerminalOutcomes: 0,
		p95FirstOutputMs: null,
	};
	return {
		since,
		until: until ?? null,
		active: Number(active?.value ?? 0),
		outcomes: rows,
		totals: {
			...totalMetrics,
			protocolErrors: Number(protocolErrorOperations[0]?.value ?? 0),
		},
		groups: { models: byModel, adapters: byAdapter, deployments: byDeployment },
	};
}

/** The column, or the expression, that one usage row is grouped under. */
function groupKeyColumn(
	groupBy: "public_model" | "virtual_key" | "actor" | "hour" | "day",
) {
	if (groupBy === "day") {
		return sql<string>`to_char(date_trunc('day', ${gatewayOperations.startedAt} at time zone 'UTC'), 'YYYY-MM-DD')`;
	}
	if (groupBy === "hour") {
		return sql<string>`to_char(date_trunc('hour', ${gatewayOperations.startedAt} at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:00:00"Z"')`;
	}
	if (groupBy === "virtual_key") {
		return gatewayOperations.virtualKeyId;
	}
	return groupBy === "actor"
		? gatewayOperations.actor
		: gatewayOperations.publicModel;
}

export async function aggregateOperationUsage(
	filter: OperationFilter & {
		groupBy: "public_model" | "virtual_key" | "actor" | "hour" | "day" | "none";
	},
) {
	const conds = conditions(filter);
	const where = conds.length > 0 ? and(...conds) : undefined;
	const metrics = {
		...cacheMetrics(gatewayOperations),
		usageReported: sql<number>`count(${gatewayOperations.totalTokens})::float8`,
		requests: count(),
		promptTokens: sql<number>`coalesce(sum(${gatewayOperations.promptTokens}), 0)::float8`,
		completionTokens: sql<number>`coalesce(sum(${gatewayOperations.completionTokens}), 0)::float8`,
		reasoningTokens: sql<number>`coalesce(sum(${gatewayOperations.reasoningTokens}), 0)::float8`,
		totalTokens: sql<number>`coalesce(sum(${gatewayOperations.totalTokens}), 0)::float8`,
		searchUnits: sql<number>`coalesce(sum(${gatewayOperations.searchUnits}), 0)::float8`,
		consumerCostCents: sql<number>`coalesce(sum(${gatewayOperations.consumerCostCents}), 0)::float8`,
		upstreamCostCents: sql<number>`coalesce(sum(${gatewayOperations.upstreamCostCents}), 0)::float8`,
	};
	if (filter.groupBy === "none") {
		const [row] = await db.select(metrics).from(gatewayOperations).where(where);
		return [{ key: null, ...row }];
	}
	// `hour` exists for 24h dashboards: `day` collapses a whole day into one point, which is useless
	// at that window. Both bucket in UTC so the series is stable regardless of the server's zone.
	const key = groupKeyColumn(filter.groupBy);
	return db
		.select({ key, ...metrics })
		.from(gatewayOperations)
		.where(where)
		.groupBy(key)
		.orderBy(desc(metrics.consumerCostCents));
}
