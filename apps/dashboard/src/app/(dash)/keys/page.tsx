import { KeysToolbar, NewKeyButton } from "#/features/keys/KeysToolbar.tsx";
import { PAGE_SIZE, parseKeysFilters } from "#/features/keys/filters.ts";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { TableSkeleton } from "#/shared/components/Skeleton.tsx";
import { KeysTable } from "#/features/keys/KeysTable.tsx";
import { KEY_HEADERS } from "#/features/keys/common.ts";
import { PageHeader } from "#/components/ui/page";
import { listKeys } from "#/features/keys/api.ts";
import { Suspense } from "react";

type Params = PageProps<"/keys">["searchParams"];

/**
 * Virtual keys. Creating one and inspecting one each have their own page (`/keys/new`,
 * `/keys/[key]`); this one lists them, under a toolbar with their state and the search.
 */
export default function KeysPage(props: PageProps<"/keys">) {
	return (
		<>
			<PageHeader
				actions={<NewKeyButton />}
				description="Virtual keys scope which public models a client may call, and carry their own rate limits and budget."
				title="API keys"
			/>
			<Suspense fallback={<KeysToolbar filters={{}} loading />}>
				<Filters searchParams={props.searchParams} />
			</Suspense>

			<RouteBoundary title="Keys could not be loaded">
				<Suspense fallback={<TableSkeleton headers={KEY_HEADERS} rows={10} />}>
					<Keys searchParams={props.searchParams} />
				</Suspense>
			</RouteBoundary>
		</>
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
		...(filters.state ? { enabled: filters.state === "enabled" } : {}),
	});
	return <KeysTable filters={filters} keys={data} total={pagination.total} />;
}
