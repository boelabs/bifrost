import { LogsToolbar, LogRows } from "#/features/observability/LogsToolbar.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { LogsTable } from "#/features/observability/LogsTable.tsx";
import { publicModelNames } from "#/features/deployments/api.ts";
import { TableSkeleton } from "#/shared/components/Skeleton.tsx";
import { listLogs } from "#/features/observability/api.ts";
import { PageHeader } from "#/components/ui/page";
import { safeRange } from "#/shared/lib/range.ts";
import { connection } from "next/server";
import { Suspense } from "react";

import {
	parseLogsFilters,
	DEFAULT_PERIOD,
	LOG_HEADERS,
	PAGE_SIZE,
} from "#/features/observability/logFilters.ts";

type Params = PageProps<"/logs">["searchParams"];

/**
 * Operation summaries.
 *
 * The toolbar and the table are separate boundaries because they need different things: the filters
 * only need the URL plus a list of model names, while the rows need a windowed query the operator
 * may well have just changed. Splitting them means changing a filter does not blank the controls
 * that changed it.
 */
export default function LogsPage(props: PageProps<"/logs">) {
	return (
		<>
			<PageHeader
				description="Operation summaries. Request and response bodies are never persisted in these rows — only metadata, alongside the encrypted forensic sample kept for every finished request."
				title="Logs"
			/>
			{/*
			 * Two boundaries, for two different waits: this one covers the model list the filter
			 * comes from and the URL the controls read; the table's covers the rows. `LogRows` hands
			 * the rows on screen to the toolbar's Export.
			 */}
			<LogRows>
				<Suspense
					fallback={
						<LogsToolbar filters={{ period: undefined }} loading models={[]} />
					}
				>
					<Filters searchParams={props.searchParams} />
				</Suspense>

				<RouteBoundary title="Operations could not be loaded">
					<Suspense
						fallback={<TableSkeleton headers={LOG_HEADERS} rows={12} />}
					>
						<Operations searchParams={props.searchParams} />
					</Suspense>
				</RouteBoundary>
			</LogRows>
		</>
	);
}

async function Filters({ searchParams }: { searchParams: Params }) {
	const [models, params] = await Promise.all([
		publicModelNames(),
		searchParams,
	]);
	return <LogsToolbar filters={parseLogsFilters(params)} models={models} />;
}

async function Operations({ searchParams }: { searchParams: Params }) {
	const filters = parseLogsFilters(await searchParams);
	// The window is anchored to today, which a prerender has no value for.
	await connection();
	const range = safeRange(filters, DEFAULT_PERIOD);
	const { data, pagination } = await listLogs({
		limit: PAGE_SIZE,
		offset: filters.offset ?? 0,
		...(filters.outcome ? { outcome: filters.outcome } : {}),
		...(filters.publicModel ? { publicModel: filters.publicModel } : {}),
		...(filters.actor ? { actor: filters.actor } : {}),
		...(filters.cause ? { failureOwner: filters.cause as never } : {}),
		...(filters.requestId ? { requestId: filters.requestId } : {}),
		...(range.start ? { start: range.start } : {}),
		...(range.end ? { end: range.end } : {}),
	});
	return <LogsTable filters={filters} rows={data} total={pagination.total} />;
}
