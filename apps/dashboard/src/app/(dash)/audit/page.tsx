import { PAGE_SIZE, parseAuditFilters } from "#/features/audit/filters.ts";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { AuditToolbar } from "#/features/audit/AuditToolbar.tsx";
import { AuditTable } from "#/features/audit/AuditTable.tsx";
import { AUDIT_HEADERS } from "#/features/audit/common.ts";
import { listAudit } from "#/features/audit/api.ts";
import { PageHeader } from "#/components/ui/page";
import { Suspense } from "react";

import {
	ToolbarSkeleton,
	TableSkeleton,
} from "#/shared/components/Skeleton.tsx";

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
				title="Audit"
				description="Who changed the gateway's configuration, and who read a retained prompt or completion. Append-only: nothing here can be edited or removed from the dashboard."
			>
				<Suspense
					fallback={<ToolbarSkeleton widths={["11rem", "16rem", "16rem"]} />}
				>
					<Filters searchParams={props.searchParams} />
				</Suspense>
			</PageHeader>

			<RouteBoundary title="The audit trail could not be loaded">
				<Suspense
					fallback={<TableSkeleton headers={AUDIT_HEADERS} rows={10} toolbar />}
				>
					<Trail searchParams={props.searchParams} />
				</Suspense>
			</RouteBoundary>
		</>
	);
}

async function Filters({ searchParams }: { searchParams: Params }) {
	return <AuditToolbar filters={parseAuditFilters(await searchParams)} />;
}

async function Trail({ searchParams }: { searchParams: Params }) {
	const filters = parseAuditFilters(await searchParams);
	const { data, pagination } = await listAudit({
		limit: PAGE_SIZE,
		offset: filters.offset ?? 0,
		...(filters.kind ? { kind: filters.kind } : {}),
		...(filters.actor ? { actor: filters.actor } : {}),
		...(filters.action ? { action: filters.action } : {}),
	});
	return <AuditTable rows={data} total={pagination.total} filters={filters} />;
}
