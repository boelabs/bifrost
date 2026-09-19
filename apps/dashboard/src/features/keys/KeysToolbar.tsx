"use client";

import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { SearchField } from "#/shared/components/SearchField.tsx";
import { Can } from "#/features/auth/session.tsx";
import type { KeysFilters } from "./filters.ts";
import { Button } from "#/components/ui/button";
import { IconPlus } from "@tabler/icons-react";
import { useNewKey } from "./KeysView.tsx";

/**
 * Search and "New key", which live in the page header while the dialog and the table they drive live
 * further down — `useNewKey` is the context that connects them without lifting the whole page into
 * one component.
 */
export function KeysToolbar({ filters }: { filters: KeysFilters }) {
	const { filter } = useSearchWriter(filters);
	const openNew = useNewKey();
	return (
		<div className="flex flex-wrap items-center gap-3">
			<SearchField
				label="Search keys"
				onSearch={(value) => filter({ q: value })}
				placeholder="Name or prefix"
				value={filters.q ?? ""}
			/>
			<Can permissions={["keys:write"]}>
				<Button onClick={openNew} size="sm">
					<IconPlus aria-hidden className="mr-2" size={15} />
					New key
				</Button>
			</Can>
		</div>
	);
}
