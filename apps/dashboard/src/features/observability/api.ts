import type { components, paths } from "#/shared/api/schema";
import { api, unwrap } from "#/shared/api/client.ts";

export type OperationRow = components["schemas"]["OperationSummaryRow"];
export type OperationDetail = components["schemas"]["OperationDetail"];
export type UsageRow = components["schemas"]["UsageRow"];
export type Summary = components["schemas"]["ObservabilitySummary"];
export type DetailedMetrics = components["schemas"]["DetailedMetrics"];
export type MetricsQuery = NonNullable<
	paths["/admin/observability/metrics"]["get"]["parameters"]["query"]
>;

export async function detailedMetrics(query: MetricsQuery) {
	return unwrap(
		await api.GET("/admin/observability/metrics", { params: { query } }),
	).data;
}

/** Reuses the generated query type so the outcome union cannot drift from the gateway's. */
type LogQuery = NonNullable<
	NonNullable<paths["/admin/logs"]["get"]["parameters"]["query"]>
>;

export interface LogFilter {
	limit?: number;
	offset?: number;
	outcome?: LogQuery["outcome"];
	publicModel?: string;
	actor?: string;
	virtualKeyId?: string;
	start?: string;
	end?: string;
}

export async function listLogs(params?: LogFilter) {
	return unwrap(await api.GET("/admin/logs", { params: { query: params } }));
}

export async function operationDetail(id: string) {
	return unwrap(await api.GET("/admin/logs/{id}", { params: { path: { id } } }))
		.data;
}

/**
 * The retained request/response sample for one operation.
 *
 * Every read is written to `payload_access_audit` by the gateway, which is why the dashboard never
 * fetches this alongside the detail: an operator opening a log should not silently produce an access
 * record for content they did not ask to see.
 */
export async function payloadSample(id: string) {
	return unwrap(
		await api.GET("/admin/logs/{id}/payload", { params: { path: { id } } }),
	).data;
}

type SummaryQuery = NonNullable<
	paths["/admin/observability/summary"]["get"]["parameters"]["query"]
>;

/**
 * Lifecycle health for a window: either a trailing shortcut for a poller, or the explicit range a
 * page's filter produced. Passing a bound makes the gateway ignore `window`, so the two never
 * disagree about what is being summarized.
 */
export async function summary(query: SummaryQuery = { window: "1h" }) {
	return unwrap(
		await api.GET("/admin/observability/summary", {
			params: { query },
		}),
	).data;
}

/**
 * `hour` exists for the 24h view: `day` would collapse the whole window into one point. Grouping by
 * `actor` is what makes operator traffic (the playground, a manual test) visible instead of showing
 * up as unattributed spend.
 */
export async function usage(params: {
	groupBy: "public_model" | "virtual_key" | "actor" | "hour" | "day" | "none";
	start?: string;
	end?: string;
	publicModel?: string;
}) {
	return unwrap(await api.GET("/admin/usage", { params: { query: params } }))
		.data;
}
