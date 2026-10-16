"use client";

import { ListToolbar, ListSelect } from "#/shared/components/ListToolbar.tsx";
import { Select, SelectItem, SearchableSelect } from "#/components/ui/select";
import { RefreshControls } from "#/shared/components/RefreshControls.tsx";
import { RangeFilter } from "#/shared/components/RangeFilter.tsx";
import { SearchField } from "#/shared/components/SearchField.tsx";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { GhostSkeleton } from "#/shared/components/Skeleton.tsx";
import { createTableRows } from "#/shared/lib/tableRows.tsx";
import { causeLabel, FAILURE_OWNERS } from "./trace.ts";
import { downloadCsv } from "#/shared/lib/csv.ts";
import { Button } from "#/components/ui/button";
import { RANGES } from "#/shared/lib/range.ts";
import type { OperationRow } from "./api.ts";
import type { ReactNode } from "react";

import {
	type LogsFilters,
	DEFAULT_PERIOD,
	LOG_PERIODS,
	isFiltered,
	OUTCOMES,
	ALL,
} from "./logFilters.ts";

import {
	FilterX as IconFilterOff,
	Download as IconDownload,
} from "lucide-react";

const OUTCOME_LABELS: Record<string, string> = {
	success: "Success",
	incomplete: "Incomplete",
	blocked: "Blocked",
	error: "Error",
	cancelled: "Cancelled",
	abandoned: "Abandoned",
} satisfies Record<(typeof OUTCOMES)[number], string>;

/**
 * How an outcome (or, while it runs, a lifecycle state) reads on screen. Display only: the URL and
 * the gateway keep the stored values.
 */
export function outcomeLabel(value: string): string {
	const known = OUTCOME_LABELS[value];
	if (known) {
		return known;
	}
	const words = value.replaceAll("_", " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

const OUTCOME_OPTIONS = [
	{ value: ALL, label: "All outcomes" },
	...OUTCOMES.map((value) => ({ value, label: outcomeLabel(value) })),
];

const CAUSE_OPTIONS = [
	{ value: ALL, label: "Any cause" },
	...FAILURE_OWNERS.map(({ value, label }) => ({ value, label })),
];

/** The operations the table shows, for *Export*: the toolbar and the table load separately. */
const logRows = createTableRows<OperationRow>();

/** Wraps the toolbar and the table, so *Export* can read the operations on screen. */
export function LogRows({ children }: { children: ReactNode }) {
	return <logRows.Provider>{children}</logRows.Provider>;
}

export const usePublishLogRows = logRows.usePublishRows;

/** The current page of operations as CSV: what is on screen is what is filtered and understood. */
function ExportButton() {
	const rows = logRows.useTableRows();
	return (
		<Button
			disabled={!rows?.length}
			onClick={() => {
				if (!rows) {
					return;
				}
				downloadCsv(
					`operations-${new Date().toISOString().slice(0, 10)}.csv`,
					rows,
					[
						["id", (row) => row.id],
						["requestId", (row) => row.requestId],
						["startedAt", (row) => row.startedAt],
						["outcome", (row) => row.outcome ?? row.lifecycleState],
						["httpStatus", (row) => row.httpStatus],
						["publicModel", (row) => row.publicModel],
						["callType", (row) => row.callType],
						["servedBy", (row) => row.servedBy],
						["actor", (row) => row.actor],
						["attempts", (row) => row.attemptCount],
						[
							"cause",
							(row) => (row.lastFailure ? causeLabel(row.lastFailure) : null),
						],
						["firstOutputMs", (row) => row.firstOutputMs],
						["durationMs", (row) => row.durationMs],
						["totalTokens", (row) => row.totalTokens],
						["stream", (row) => row.stream],
						["cacheHit", (row) => row.cacheHit],
					],
				);
			}}
			variant="secondary"
		>
			<IconDownload aria-hidden className="size-4" />
			Export
		</Button>
	);
}

/** A control's ghost while the page loads; `grow` for the ones that fill a phone's row. */
function Ghost({
	loading,
	grow = false,
	children,
}: {
	loading: boolean;
	grow?: boolean;
	children: ReactNode;
}) {
	if (!loading) {
		return children;
	}
	return (
		<GhostSkeleton
			className={grow ? "min-w-0 @min-[40rem]:flex-none flex-1" : undefined}
		>
			{children}
		</GhostSkeleton>
	);
}

/**
 * Everything above the log table: the period, outcome, cause and model on one side; the searches,
 * Refresh and Export on the other.
 *
 * `models` comes from the deployment list, fetched by the page so a role that cannot read
 * deployments still gets a working page, with one filter fewer. `filters` is the URL as the page's
 * schema parsed it — see `shared/lib/useSearchWriter.ts`. `loading` draws the same toolbar as
 * ghosts for the page's fallback.
 */
export function LogsToolbar({
	models,
	filters,
	loading = false,
}: {
	models: string[];
	filters: LogsFilters;
	loading?: boolean;
}) {
	const { filter, clear } = useSearchWriter(filters);
	const { outcome, publicModel } = filters;
	const actor = filters.actor ?? "";
	const requestId = filters.requestId ?? "";
	const filtered = isFiltered(filters);

	const toolbar = (
		<ListToolbar
			controls={
				<>
					<Ghost grow loading={loading}>
						<SearchField
							label="Filter by actor"
							onSearch={(value) => filter({ actor: value })}
							placeholder="Actor"
							value={actor}
						/>
					</Ghost>
					<Ghost grow loading={loading}>
						<SearchField
							label="Find a request ID"
							onSearch={(value) => filter({ requestId: value || undefined })}
							placeholder="Request ID"
							value={requestId}
						/>
					</Ghost>
					{filtered ? (
						<Button
							onClick={() => clear(["period", "from", "to"])}
							variant="ghost"
						>
							<IconFilterOff aria-hidden className="size-4" />
							Clear filters
						</Button>
					) : null}
					<Ghost loading={loading}>
						<RefreshControls />
					</Ghost>
					<Ghost loading={loading}>
						<ExportButton />
					</Ghost>
				</>
			}
			selects={
				<>
					{loading ? (
						// The period's ghost is a plain select: `RangeFilter` reads today's date, which
						// the prerendered shell this fallback belongs to has no value for.
						<GhostSkeleton>
							<Select aria-label="Time range" value={DEFAULT_PERIOD}>
								<SelectItem value={DEFAULT_PERIOD}>
									{RANGES[DEFAULT_PERIOD]}
								</SelectItem>
							</Select>
						</GhostSkeleton>
					) : (
						<RangeFilter
							fallback={DEFAULT_PERIOD}
							onChange={(patch) => filter(patch)}
							periods={LOG_PERIODS}
							value={filters}
						/>
					)}
					<Ghost grow loading={loading}>
						<ListSelect
							kind="segment"
							label="Filter by outcome"
							onValueChange={(key) =>
								filter({ outcome: key === ALL ? undefined : key })
							}
							options={OUTCOME_OPTIONS}
							value={outcome ?? ALL}
						/>
					</Ghost>
					<Ghost grow loading={loading}>
						<ListSelect
							kind="segment"
							label="Filter by failure cause"
							onValueChange={(key) =>
								filter({ cause: key === ALL ? undefined : key })
							}
							options={CAUSE_OPTIONS}
							value={filters.cause ?? ALL}
						/>
					</Ghost>
					{/* While loading, the model list is not known yet; most roles get the filter. */}
					{loading || models.length > 0 ? (
						<Ghost grow loading={loading}>
							<div className="@min-[40rem]:w-44 min-w-0 @min-[40rem]:flex-none flex-1">
								<SearchableSelect
									aria-label="Filter by public model"
									className="w-full"
									clearLabel="All models"
									items={models.map((model) => ({
										value: model,
										label: model,
									}))}
									onValueChange={(key) =>
										filter({
											publicModel: !key || key === ALL ? undefined : key,
										})
									}
									searchPlaceholder="Search public models"
									value={publicModel ?? null}
									width="100%"
								/>
							</div>
						</Ghost>
					) : null}
				</>
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
