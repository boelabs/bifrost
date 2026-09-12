"use client";

import { RefreshControls } from "#/shared/components/RefreshControls.tsx";
import { SearchField } from "#/shared/components/SearchField.tsx";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { Select, SelectItem } from "#/components/ui/select";
import { IconFilterOff } from "@tabler/icons-react";
import { Button } from "#/components/ui/button";

import {
	type LogsFilters,
	DEFAULT_PERIOD,
	isFiltered,
	OUTCOMES,
	PERIODS,
	ALL,
} from "./logFilters.ts";

/**
 * Everything above the log table that only needs the URL.
 *
 * `models` is the one exception — it comes from the deployment list, fetched by the page so a role
 * that cannot read deployments still gets a working page, with one filter fewer.
 */
/**
 * Everything above the log table.
 *
 * `models` comes from the deployment list, fetched by the page so a role that cannot read
 * deployments still gets a working page, with one filter fewer. `filters` is the URL as the page's
 * schema parsed it — see `shared/lib/useSearchWriter.ts`.
 */
export function LogsToolbar({
	models,
	filters,
}: {
	models: string[];
	filters: LogsFilters;
}) {
	const { filter, clear } = useSearchWriter(filters);
	const period = filters.period ?? DEFAULT_PERIOD;
	const { outcome, publicModel } = filters;
	const actor = filters.actor ?? "";
	const filtered = isFiltered(filters);

	return (
		<div className="flex flex-wrap items-center gap-2">
			<Select
				aria-label="Time range"
				size="sm"
				value={period}
				onValueChange={(key) => filter({ period: key ?? DEFAULT_PERIOD })}
			>
				{Object.entries(PERIODS).map(([key, value]) => (
					<SelectItem key={key} value={key}>
						{value.label}
					</SelectItem>
				))}
			</Select>
			<Select
				aria-label="Filter by outcome"
				size="sm"
				value={outcome ?? ALL}
				onValueChange={(key) =>
					filter({ outcome: !key || key === ALL ? undefined : key })
				}
			>
				<SelectItem value={ALL}>All outcomes</SelectItem>
				{OUTCOMES.map((value) => (
					<SelectItem key={value} value={value}>
						{value}
					</SelectItem>
				))}
			</Select>
			{models.length > 0 ? (
				<Select
					aria-label="Filter by public model"
					size="sm"
					value={publicModel ?? ALL}
					onValueChange={(key) =>
						filter({ publicModel: !key || key === ALL ? undefined : key })
					}
				>
					<SelectItem value={ALL}>All models</SelectItem>
					{models.map((model) => (
						<SelectItem key={model} value={model}>
							{model}
						</SelectItem>
					))}
				</Select>
			) : null}
			<SearchField
				label="Filter by actor"
				placeholder="Actor"
				value={actor}
				onSearch={(value) => filter({ actor: value })}
			/>
			{filtered ? (
				<Button size="sm" variant="ghost" onClick={() => clear(["period"])}>
					<IconFilterOff size={15} aria-hidden className="mr-1" />
					Clear filters
				</Button>
			) : null}
			<RefreshControls />
		</div>
	);
}
