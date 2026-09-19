"use client";

import { ALL, AUDIT_PERIODS, DEFAULT_PERIOD, KINDS } from "./filters.ts";
import { RangeFilter } from "#/shared/components/RangeFilter.tsx";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { SearchField } from "#/shared/components/SearchField.tsx";
import { type AuditFilters, isFiltered } from "./filters.ts";
import { Select, SelectItem } from "#/components/ui/select";
import { IconFilterOff } from "@tabler/icons-react";
import { Button } from "#/components/ui/button";

/**
 * The filters. `filters` comes from the page, which parsed the URL with the same schema the loader
 * used — see `shared/lib/useSearchWriter.ts` for why the controls do not read it themselves.
 */
export function AuditToolbar({ filters }: { filters: AuditFilters }) {
	const { filter, clear } = useSearchWriter(filters);
	return (
		<div className="flex flex-wrap items-center gap-2">
			<RangeFilter
				fallback={DEFAULT_PERIOD}
				onChange={(patch) => filter(patch)}
				periods={AUDIT_PERIODS}
				value={filters}
			/>
			<Select
				aria-label="Filter by kind"
				onValueChange={(key) =>
					filter({ kind: !key || key === ALL ? undefined : key })
				}
				size="sm"
				value={filters.kind ?? ALL}
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
				onSearch={(value) => filter({ actor: value })}
				placeholder="Actor"
				value={filters.actor ?? ""}
			/>
			<SearchField
				label="Filter by action"
				onSearch={(value) => filter({ action: value })}
				placeholder="DELETE, /admin/keys…"
				value={filters.action ?? ""}
			/>
			{isFiltered(filters) ? (
				<Button onClick={() => clear()} size="sm" variant="ghost">
					<IconFilterOff aria-hidden className="mr-1" size={15} />
					Clear filters
				</Button>
			) : null}
		</div>
	);
}
