"use client";

import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { SearchField } from "#/shared/components/SearchField.tsx";
import { type AuditFilters, isFiltered } from "./filters.ts";
import { Select, SelectItem } from "#/components/ui/select";
import { IconFilterOff } from "@tabler/icons-react";
import { Button } from "#/components/ui/button";
import { ALL, KINDS } from "./filters.ts";

/**
 * The filters. `filters` comes from the page, which parsed the URL with the same schema the loader
 * used — see `shared/lib/useSearchWriter.ts` for why the controls do not read it themselves.
 */
export function AuditToolbar({ filters }: { filters: AuditFilters }) {
	const { filter, clear } = useSearchWriter(filters);
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Select
				aria-label="Filter by kind"
				size="sm"
				value={filters.kind ?? ALL}
				onValueChange={(key) =>
					filter({ kind: !key || key === ALL ? undefined : key })
				}
			>
				<SelectItem value={ALL}>Everything</SelectItem>
				{Object.entries(KINDS).map(([value, label]) => (
					<SelectItem key={value} value={value}>
						{label}
					</SelectItem>
				))}
			</Select>
			<SearchField
				label="Filter by actor"
				placeholder="Actor"
				value={filters.actor ?? ""}
				onSearch={(value) => filter({ actor: value })}
			/>
			<SearchField
				label="Filter by action"
				placeholder="DELETE, /admin/keys…"
				value={filters.action ?? ""}
				onSearch={(value) => filter({ action: value })}
			/>
			{isFiltered(filters) ? (
				<Button size="sm" variant="ghost" onClick={() => clear()}>
					<IconFilterOff size={15} aria-hidden className="mr-1" />
					Clear filters
				</Button>
			) : null}
		</div>
	);
}
