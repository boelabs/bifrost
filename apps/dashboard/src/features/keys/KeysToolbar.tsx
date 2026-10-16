"use client";

import { ListToolbar, ListSelect } from "#/shared/components/ListToolbar.tsx";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { SearchField } from "#/shared/components/SearchField.tsx";
import { type KeysFilters, KEY_STATES } from "./filters.ts";
import { Can } from "#/features/auth/session.tsx";
import { type ReactNode, Suspense } from "react";
import { Button } from "#/components/ui/button";
import { Plus as IconPlus } from "lucide-react";
import Link from "next/link";

import {
	ButtonSkeleton,
	GhostSkeleton,
} from "#/shared/components/Skeleton.tsx";

/** A control's ghost while the page loads, sized as the control is in the toolbar. */
function Ghost({
	loading,
	children,
}: {
	loading: boolean;
	children: ReactNode;
}) {
	return loading ? (
		<GhostSkeleton className="min-w-0 @min-[40rem]:flex-none flex-1">
			{children}
		</GhostSkeleton>
	) : (
		children
	);
}

/**
 * Above the list: its segment (all, enabled or disabled keys) on one side, its search on the other.
 * `loading` draws the same toolbar as ghosts for the page's fallback.
 */
export function KeysToolbar({
	filters,
	loading = false,
}: {
	filters: KeysFilters;
	loading?: boolean;
}) {
	const { filter } = useSearchWriter(filters);
	const toolbar = (
		<ListToolbar
			controls={
				<Ghost loading={loading}>
					<SearchField
						label="Search keys"
						onSearch={(value) => filter({ q: value })}
						placeholder="Name or prefix"
						value={filters.q ?? ""}
					/>
				</Ghost>
			}
			selects={
				<Ghost loading={loading}>
					<ListSelect
						kind="segment"
						label="Filter keys by state"
						onValueChange={(value) =>
							filter({ state: value === "all" ? undefined : value })
						}
						options={KEY_STATES}
						value={filters.state ?? "all"}
					/>
				</Ghost>
			}
		/>
	);
	return loading ? (
		<div aria-hidden="true" inert>
			{toolbar}
		</div>
	) : (
		toolbar
	);
}

/**
 * The page header's primary action. Its own `<Suspense>` boundary: the button waits on the
 * operator's permissions, and a `<Suspense>` the page passes *into* `PageHeader` (a Client Component)
 * does not count as one during prerendering.
 */
export function NewKeyButton() {
	return (
		<Suspense fallback={<ButtonSkeleton label={7} size="md" />}>
			<Can permissions={["keys:write"]}>
				<Button nativeButton={false} render={<Link href="/keys/new" />}>
					<IconPlus aria-hidden className="size-4" />
					New key
				</Button>
			</Can>
		</Suspense>
	);
}
