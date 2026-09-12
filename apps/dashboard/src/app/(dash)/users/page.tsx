import { PAGE_SIZE, parseUsersFilters } from "#/features/users/filters.ts";
import { RoleLegend, UsersTable } from "#/features/users/UsersView.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { UsersToolbar } from "#/features/users/UsersToolbar.tsx";
import { USER_HEADERS } from "#/features/users/common.ts";
import { listUsers } from "#/features/users/api.ts";
import { PageHeader } from "#/components/ui/page";
import { Suspense } from "react";

import {
	ToolbarSkeleton,
	TableSkeleton,
} from "#/shared/components/Skeleton.tsx";

type Params = PageProps<"/users">["searchParams"];

/**
 * Dashboard operators.
 *
 * The role legend is static text, so it renders with the header rather than behind a boundary — an
 * owner deciding what to grant can read it while the account list is still arriving.
 */
export default function UsersPage(props: PageProps<"/users">) {
	return (
		<>
			<PageHeader
				title="Users"
				description="Operators of this dashboard. Accounts exist only because an owner created them — there is no self-registration and no OAuth."
			>
				<Suspense fallback={<ToolbarSkeleton widths={["17rem", "6.5rem"]} />}>
					<Filters searchParams={props.searchParams} />
				</Suspense>
			</PageHeader>

			<RoleLegend />

			<RouteBoundary title="Users could not be loaded">
				<Suspense fallback={<TableSkeleton headers={USER_HEADERS} rows={8} />}>
					<Operators searchParams={props.searchParams} />
				</Suspense>
			</RouteBoundary>
		</>
	);
}

async function Filters({ searchParams }: { searchParams: Params }) {
	return <UsersToolbar filters={parseUsersFilters(await searchParams)} />;
}

async function Operators({ searchParams }: { searchParams: Params }) {
	const filters = parseUsersFilters(await searchParams);
	const { data, pagination } = await listUsers({
		limit: PAGE_SIZE,
		offset: filters.offset ?? 0,
		...(filters.q ? { q: filters.q } : {}),
	});
	return <UsersTable users={data} total={pagination.total} filters={filters} />;
}
