import { AuditToolbar, AuditRows } from "#/features/audit/AuditToolbar.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { TableSkeleton } from "#/shared/components/Skeleton.tsx";
import { AuditTable } from "#/features/audit/AuditTable.tsx";
import { AUDIT_HEADERS } from "#/features/audit/common.ts";
import { listAudit } from "#/features/audit/api.ts";
import { safeRange } from "#/shared/lib/range.ts";
import { PageHeader } from "#/components/ui/page";
import { connection } from "next/server";
import { Suspense } from "react";

import {
	parseAuditFilters,
	DEFAULT_PERIOD,
	PAGE_SIZE,
} from "#/features/audit/filters.ts";

type Params = PageProps<"/audit">["searchParams"];

/**
 * The audit trail.
 *
 * The title and description need nothing from the gateway, so they belong to the route's App Shell
 * and are on screen the moment the link is clicked. The filters follow as soon as the URL is read,
 * and the rows stream into a table that already has its real headers and row height.
 */
export default function AuditPage(props: PageProps<"/audit">) {
	return (
		<>
			<PageHeader
				description="Who changed the gateway's configuration, and who read a retained prompt or completion. Append-only: nothing here can be edited or removed from the dashboard."
				title="Audit"
			/>
			<AuditRows>
				<Suspense
					fallback={<AuditToolbar filters={{ period: undefined }} loading />}
				>
					<Filters searchParams={props.searchParams} />
				</Suspense>

				<RouteBoundary title="The audit trail could not be loaded">
					<Suspense
						fallback={
							<TableSkeleton headers={AUDIT_HEADERS} pagination rows={10} />
						}
					>
						<Trail searchParams={props.searchParams} />
					</Suspense>
				</RouteBoundary>
			</AuditRows>
		</>
	);
}

async function Filters({ searchParams }: { searchParams: Params }) {
	return <AuditToolbar filters={parseAuditFilters(await searchParams)} />;
}

async function Trail({ searchParams }: { searchParams: Params }) {
	const filters = parseAuditFilters(await searchParams);
	// A day-anchored range is relative to today, which a prerender has no value for.
	await connection();
	const range = safeRange(filters, DEFAULT_PERIOD);
	const { data, pagination } = await listAudit({
		limit: PAGE_SIZE,
		offset: filters.offset ?? 0,
		...(filters.kind ? { kind: filters.kind } : {}),
		...(filters.actor ? { actor: filters.actor } : {}),
		...(filters.action ? { action: filters.action } : {}),
		...(range.start ? { start: range.start } : {}),
		...(range.end ? { end: range.end } : {}),
	});
	return <AuditTable filters={filters} rows={data} total={pagination.total} />;
}
