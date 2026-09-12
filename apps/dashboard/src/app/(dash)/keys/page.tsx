import { PAGE_SIZE, parseKeysFilters } from "#/features/keys/filters.ts";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { publicModelNames } from "#/features/deployments/api.ts";
import { KeysToolbar } from "#/features/keys/KeysToolbar.tsx";
import { KeysProvider } from "#/features/keys/KeysView.tsx";
import { KeysTable } from "#/features/keys/KeysTable.tsx";
import { KEY_HEADERS } from "#/features/keys/common.ts";
import { PageHeader } from "#/components/ui/page";
import { listKeys } from "#/features/keys/api.ts";
import { Suspense } from "react";

import {
	ToolbarSkeleton,
	TableSkeleton,
} from "#/shared/components/Skeleton.tsx";

type Params = PageProps<"/keys">["searchParams"];

/**
 * Virtual keys.
 *
 * `KeysProvider` wraps both boundaries because the "New key" button sits in the header and the row
 * it edits sits in the table — they share one dialog. The model suggestions that dialog offers are
 * started here but never awaited, so neither boundary waits on a list that only matters once a
 * dialog is open.
 */
export default function KeysPage(props: PageProps<"/keys">) {
	return (
		<KeysProvider models={publicModelNames()}>
			<PageHeader
				title="API keys"
				description="Virtual keys scope which public models a client may call, and carry their own rate limits and budget."
			>
				<Suspense fallback={<ToolbarSkeleton widths={["17rem", "6.5rem"]} />}>
					<Filters searchParams={props.searchParams} />
				</Suspense>
			</PageHeader>

			<RouteBoundary title="Keys could not be loaded">
				<Suspense fallback={<TableSkeleton headers={KEY_HEADERS} rows={10} />}>
					<Keys searchParams={props.searchParams} />
				</Suspense>
			</RouteBoundary>
		</KeysProvider>
	);
}

async function Filters({ searchParams }: { searchParams: Params }) {
	return <KeysToolbar filters={parseKeysFilters(await searchParams)} />;
}

async function Keys({ searchParams }: { searchParams: Params }) {
	const filters = parseKeysFilters(await searchParams);
	const { data, pagination } = await listKeys({
		limit: PAGE_SIZE,
		offset: filters.offset ?? 0,
		...(filters.q ? { q: filters.q } : {}),
	});
	return <KeysTable keys={data} total={pagination.total} filters={filters} />;
}
