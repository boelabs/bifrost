"use client";

import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { ButtonSkeleton } from "#/shared/components/Skeleton.tsx";
import { SearchField } from "#/shared/components/SearchField.tsx";
import { Can } from "#/features/auth/session.tsx";
import type { KeysFilters } from "./filters.ts";
import { Button } from "#/components/ui/button";
import { Plus as IconPlus } from "lucide-react";
import { Suspense } from "react";
import Link from "next/link";

/** The list's search, in the row under the page header. */
export function KeysToolbar({ filters }: { filters: KeysFilters }) {
	const { filter } = useSearchWriter(filters);
	return (
		<div className="flex flex-wrap items-center gap-3">
			<SearchField
				label="Search keys"
				onSearch={(value) => filter({ q: value })}
				placeholder="Name or prefix"
				value={filters.q ?? ""}
			/>
		</div>
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
