"use client";

import { Select, SelectItem, SearchableSelect } from "#/components/ui/select";
import { ListToolbar, ListSelect } from "#/shared/components/ListToolbar";
import { SearchField } from "#/shared/components/SearchField";
import { RowActions } from "#/shared/components/RowActions";
import { Frame, FrameFooter } from "#/components/ui/frame";
import { useState, type ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import type { Deployment } from "./common";
import Link from "next/link";

import {
	MenuCheckboxItemIndicator,
	MenuCheckboxItem,
	MenuPositioner,
	MenuTrigger,
	MenuPortal,
	MenuPopup,
	MenuRoot,
} from "#/components/ui/menu";

import {
	type ModelOrder,
	filterModelRows,
	sortModelRows,
	MODEL_ORDERS,
	isModelOrder,
	modelRowPage,
} from "./modelTableState";

import {
	ChevronRight,
	ChevronLeft,
	Columns3,
	FilterX,
	Pencil,
	Trash2,
	Check,
	Ban,
} from "lucide-react";

import {
	TableHeader,
	TableBody,
	TableHead,
	TableCell,
	TableRow,
	Table,
} from "#/components/ui/table";

import {
	ButtonSkeleton,
	GhostSkeleton,
	Skeleton,
} from "#/shared/components/Skeleton";

interface ModelsTableProps {
	deployments?: Deployment[];
	writable?: boolean;
	loading?: boolean;
	onEdit?: (deployment: Deployment) => void;
	onToggle?: (deployment: Deployment) => void;
	onDelete?: (deployment: Deployment) => void;
}

/** Identity first, as in Billete's lists; the deployment's own id is the last, optional detail. */
const COLUMNS = [
	{ key: "publicModel", label: "Model", width: 280, visible: true },
	{ key: "adapterKey", label: "Provider", width: 120, visible: true },
	{ key: "enabled", label: "State", width: 110, visible: true },
	{ key: "limits", label: "Limits", width: 140, visible: false },
	{ key: "pricing", label: "Pricing", width: 170, visible: false },
	{ key: "createdAt", label: "Created", width: 120, visible: true },
	{ key: "updatedAt", label: "Updated", width: 120, visible: true },
	{ key: "id", label: "Deployment ID", width: 140, visible: true },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];
const LOADING_ROWS = ["first", "second", "third", "fourth", "fifth"];
const ALL = "all";
const STATE_OPTIONS = [
	{ value: ALL, label: "All states" },
	{ value: "enabled", label: "Enabled" },
	{ value: "disabled", label: "Disabled" },
] as const;
/** The width a toolbar control takes: a phone's whole row, or its own from 40rem up. */
const GROW = "min-w-0 flex-1 @min-[40rem]:flex-none";
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	year: "numeric",
	timeZone: "UTC",
});
const TIME_FORMAT = new Intl.DateTimeFormat("en-GB", {
	hour: "2-digit",
	minute: "2-digit",
	timeZone: "UTC",
});
const MONEY_FORMAT = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 6,
});

function Placeholder({
	loading,
	children,
	className,
}: {
	loading: boolean;
	children: ReactNode;
	className?: string;
}) {
	return loading ? (
		<GhostSkeleton className={className}>{children}</GhostSkeleton>
	) : (
		children
	);
}

function Timestamp({ value }: { value: string }) {
	const date = new Date(value);
	return (
		// Billete's list dates: one muted line, the day; the exact UTC time on hover.
		<time
			className="whitespace-nowrap text-muted-foreground tabular-nums"
			dateTime={value}
			title={`${DATE_FORMAT.format(date)}, ${TIME_FORMAT.format(date)} UTC`}
		>
			{DATE_FORMAT.format(date)}
		</time>
	);
}

function PricingCell({ deployment }: { deployment: Deployment }) {
	const { pricing } = deployment;
	if (!pricing) {
		return (
			<span className="text-muted-foreground" title="No pricing override">
				—
			</span>
		);
	}
	return (
		<div className="flex flex-col gap-1 text-xs tabular-nums">
			<span className="text-muted-foreground">USD / 1M tokens</span>
			<span>
				In{" "}
				{pricing.inputCentsPerMTokens === undefined
					? "—"
					: MONEY_FORMAT.format(pricing.inputCentsPerMTokens / 100)}{" "}
				· Out{" "}
				{pricing.outputCentsPerMTokens === undefined
					? "—"
					: MONEY_FORMAT.format(pricing.outputCentsPerMTokens / 100)}
			</span>
			{pricing.searchUnitCents === undefined ? null : (
				<span className="text-muted-foreground">
					{MONEY_FORMAT.format(pricing.searchUnitCents / 100)} / search
				</span>
			)}
			{pricing.tiers?.length ? (
				<span className="text-muted-foreground">Tiered rates</span>
			) : null}
		</div>
	);
}

function CellContent({
	column,
	deployment,
}: {
	column: ColumnKey;
	deployment?: Deployment;
}) {
	if (!deployment) {
		if (["publicModel", "pricing", "limits"].includes(column)) {
			return (
				<div className="flex flex-col gap-1">
					<Skeleton
						className={column === "publicModel" ? "h-3.5 w-3/4" : "h-4 w-3/4"}
					/>
					<Skeleton className="h-4 w-3/5" />
				</div>
			);
		}
		return (
			<Skeleton
				className={column === "enabled" ? "h-5 w-20 rounded-md" : "h-3.5 w-20"}
			/>
		);
	}
	switch (column) {
		case "id":
			return (
				<div className="flex min-w-0 flex-col gap-1">
					<code
						className="w-fit rounded-md bg-muted px-1.5 text-muted-foreground text-xs"
						title={deployment.id}
					>
						{deployment.id.slice(0, 8)}…
					</code>
					{deployment.label ? (
						<span
							className="truncate text-muted-foreground text-xs"
							title={deployment.label}
						>
							{deployment.label}
						</span>
					) : null}
				</div>
			);
		case "publicModel":
			return (
				<div className="flex min-w-0 flex-col gap-1">
					{/* The row's link: it stretches over the whole row, under the row's own menu. */}
					<Link
						className="truncate font-medium outline-none after:absolute after:inset-0 after:rounded-[inherit] hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
						href={`/models/${deployment.id}`}
						title={deployment.publicModel}
					>
						{deployment.publicModel}
					</Link>
					<span
						className="truncate font-mono text-muted-foreground text-xs"
						title={deployment.upstreamModel}
					>
						{deployment.upstreamModel}
					</span>
				</div>
			);
		case "adapterKey":
			return (
				<span
					className="block truncate text-muted-foreground"
					title={deployment.adapterKey}
				>
					{deployment.adapterKey}
				</span>
			);
		case "enabled":
			return (
				<Status tone={deployment.enabled ? "success" : "neutral"}>
					{deployment.enabled ? "Enabled" : "Disabled"}
				</Status>
			);
		case "createdAt":
		case "updatedAt":
			return <Timestamp value={deployment[column]} />;
		case "limits":
			return (
				<div className="flex flex-col gap-1 text-muted-foreground text-xs tabular-nums">
					{deployment.rpmLimit === null ? null : (
						<span>{deployment.rpmLimit.toLocaleString("en-US")} rpm</span>
					)}
					{deployment.tpmLimit === null ? null : (
						<span>{deployment.tpmLimit.toLocaleString("en-US")} tpm</span>
					)}
					{deployment.rpmLimit === null && deployment.tpmLimit === null ? (
						<span title="No limits">—</span>
					) : null}
				</div>
			);
		case "pricing":
			return <PricingCell deployment={deployment} />;
		default:
			return null;
	}
}

function DeploymentActions({
	deployment,
	writable,
	onEdit,
	onToggle,
	onDelete,
}: ModelsTableProps & { deployment: Deployment }) {
	return writable ? (
		<RowActions
			actions={[
				{
					label: deployment.enabled ? "Disable" : "Enable",
					icon: deployment.enabled ? (
						<Ban aria-hidden className="size-4" />
					) : (
						<Check aria-hidden className="size-4" />
					),
					onSelect: () => onToggle?.(deployment),
				},
				{
					label: "Edit",
					icon: <Pencil aria-hidden className="size-4" />,
					onSelect: () => onEdit?.(deployment),
				},
				{
					label: "Delete",
					icon: <Trash2 aria-hidden className="size-4" />,
					danger: true,
					onSelect: () => onDelete?.(deployment),
				},
			]}
			label={`Actions for deployment ${deployment.id}`}
		/>
	) : null;
}

export function ModelsTable({
	deployments = [],
	loading = false,
	...actions
}: ModelsTableProps) {
	const [filters, setFilters] = useState({
		query: "",
		provider: "",
		state: "",
	});
	const [requestedPage, setPage] = useState(0);
	const [pageSize, setPageSize] = useState(10);
	const [order, setOrder] = useState<ModelOrder>("model");
	const [visibleKeys, setVisibleKeys] = useState<ColumnKey[]>(
		COLUMNS.filter((column) => column.visible).map((column) => column.key),
	);
	const columns = COLUMNS.filter((column) => visibleKeys.includes(column.key));
	const rows = sortModelRows(filterModelRows(deployments, filters), order);
	const pagination = modelRowPage(rows, requestedPage, pageSize);
	const providers = [
		...new Set(deployments.map((row) => row.adapterKey)),
	].sort();
	const filtered = Object.values(filters).some(Boolean);
	function updateFilter(key: keyof typeof filters, value: string) {
		setFilters((previous) => ({ ...previous, [key]: value }));
		setPage(0);
	}
	return (
		<div
			aria-busy={loading || undefined}
			className="flex min-w-0 flex-col gap-6"
		>
			{loading ? (
				<span className="sr-only" role="status">
					Loading models
				</span>
			) : null}
			{/* Billete's list toolbar, above the table's tray rather than inside it. */}
			<div aria-hidden={loading || undefined} inert={loading || undefined}>
				<ListToolbar
					controls={
						<>
							<Placeholder className={GROW} loading={loading}>
								<SearchField
									label="Search models and deployments"
									onSearch={(value) => updateFilter("query", value)}
									placeholder="Search models or deployments"
									value={filters.query}
								/>
							</Placeholder>
							{filtered ? (
								<Button
									onClick={() => {
										setFilters({ query: "", provider: "", state: "" });
										setPage(0);
									}}
									variant="ghost"
								>
									<FilterX aria-hidden className="size-4" />
									Clear filters
								</Button>
							) : null}
							<Placeholder loading={loading}>
								<MenuRoot>
									<MenuTrigger render={<Button variant="secondary" />}>
										<Columns3 aria-hidden className="size-4" />
										Columns
									</MenuTrigger>
									<MenuPortal>
										<MenuPositioner align="end">
											<MenuPopup>
												{COLUMNS.map((column) => (
													<MenuCheckboxItem
														checked={visibleKeys.includes(column.key)}
														closeOnClick={false}
														disabled={column.key === "publicModel"}
														key={column.key}
														onCheckedChange={(checked) =>
															setVisibleKeys((previous) =>
																checked
																	? [...previous, column.key]
																	: previous.filter(
																			(key) => key !== column.key,
																		),
															)
														}
													>
														{column.label}{" "}
														<MenuCheckboxItemIndicator>
															<Check aria-hidden className="size-4" />
														</MenuCheckboxItemIndicator>
													</MenuCheckboxItem>
												))}
											</MenuPopup>
										</MenuPositioner>
									</MenuPortal>
								</MenuRoot>
							</Placeholder>
						</>
					}
					selects={
						<>
							<Placeholder className={GROW} loading={loading}>
								<div className="@min-[40rem]:w-44 min-w-0 @min-[40rem]:flex-none flex-1">
									<SearchableSelect
										aria-label="Filter by provider"
										className="w-full"
										clearLabel="All providers"
										items={providers.map((value) => ({ value, label: value }))}
										onValueChange={(value) =>
											updateFilter("provider", value ?? "")
										}
										searchPlaceholder="Search providers"
										value={filters.provider || null}
										width="100%"
									/>
								</div>
							</Placeholder>
							<Placeholder className={GROW} loading={loading}>
								<ListSelect
									kind="segment"
									label="Filter by state"
									onValueChange={(value) =>
										updateFilter("state", value === ALL ? "" : value)
									}
									options={STATE_OPTIONS}
									value={filters.state || ALL}
								/>
							</Placeholder>
							<Placeholder className={GROW} loading={loading}>
								<ListSelect
									kind="sort"
									label="Order models"
									onValueChange={(value) => {
										if (isModelOrder(value)) {
											setOrder(value);
											setPage(0);
										}
									}}
									options={MODEL_ORDERS}
									value={order}
								/>
							</Placeholder>
						</>
					}
				/>
			</div>
			<Frame>
				<div aria-hidden={loading || undefined} inert={loading || undefined}>
					<Table
						aria-label="Public models and deployments"
						className="table-fixed"
						style={{
							minWidth: columns.reduce(
								(total, column) => total + column.width,
								52,
							),
						}}
						variant="card"
					>
						<colgroup>
							{columns.map((column) => (
								<col
									key={column.key}
									style={
										column.key === "publicModel"
											? undefined
											: { width: column.width }
									}
								/>
							))}
							<col style={{ width: 52 }} />
						</colgroup>
						<TableHeader>
							<TableRow>
								{/* Plain headers, as in Billete: the order lives in the toolbar. */}
								{columns.map((column) => (
									<TableHead key={column.key}>{column.label}</TableHead>
								))}
								<TableHead>
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{loading
								? LOADING_ROWS.map((key) => (
										<TableRow className="h-14" key={key}>
											{columns.map((column) => (
												<TableCell className="max-w-0" key={column.key}>
													<CellContent column={column.key} />
												</TableCell>
											))}
											<TableCell>
												<ButtonSkeleton label={0} mode="icon" />
											</TableCell>
										</TableRow>
									))
								: pagination.rows.map((deployment) => (
										<TableRow
											className="relative h-14 cursor-pointer"
											key={deployment.id}
										>
											{columns.map((column) => (
												<TableCell className="max-w-0" key={column.key}>
													<CellContent
														column={column.key}
														deployment={deployment}
													/>
												</TableCell>
											))}
											<TableCell className="relative z-10">
												<DeploymentActions
													{...actions}
													deployment={deployment}
												/>
											</TableCell>
										</TableRow>
									))}
							{!loading && rows.length === 0 ? (
								<TableRow>
									<TableCell
										className="h-40 text-center"
										colSpan={columns.length + 1}
									>
										<p className="font-medium">
											{deployments.length
												? "No matching deployments"
												: "No deployments yet"}
										</p>
										<p className="mt-2 text-muted-foreground text-sm">
											{deployments.length
												? "Try another search or clear the filters."
												: "Create a deployment to make its public model available."}
										</p>
									</TableCell>
								</TableRow>
							) : null}
						</TableBody>
					</Table>
					<FrameFooter className="flex flex-wrap items-center justify-between gap-3 p-2 text-muted-foreground text-sm">
						<Placeholder loading={loading}>
							<div className="flex items-center gap-2">
								<span>Rows per page</span>
								<Select
									aria-label="Rows per page"
									onValueChange={(value) => {
										setPageSize(Number(value ?? 10));
										setPage(0);
									}}
									size="sm"
									value={String(pageSize)}
								>
									{[10, 25, 50].map((size) => (
										<SelectItem key={size} value={String(size)}>
											{size}
										</SelectItem>
									))}
								</Select>
							</div>
						</Placeholder>
						<Placeholder loading={loading}>
							<div className="flex flex-wrap items-center gap-3">
								<span className="tabular-nums" role="status">
									{pagination.start}–{pagination.end} of {rows.length}{" "}
									deployments
								</span>
								<nav
									aria-label="Models pagination"
									className="flex items-center gap-2"
								>
									<Button
										aria-label="Previous page"
										disabled={pagination.page === 0}
										mode="icon"
										onClick={() => setPage(pagination.page - 1)}
										size="sm"
										variant="secondary"
									>
										<ChevronLeft aria-hidden className="size-4" />
									</Button>
									<span className="text-xs tabular-nums">
										{pagination.page + 1} / {pagination.pageCount}
									</span>
									<Button
										aria-label="Next page"
										disabled={pagination.page + 1 >= pagination.pageCount}
										mode="icon"
										onClick={() => setPage(pagination.page + 1)}
										size="sm"
										variant="secondary"
									>
										<ChevronRight aria-hidden className="size-4" />
									</Button>
								</nav>
							</div>
						</Placeholder>
					</FrameFooter>
				</div>
			</Frame>
		</div>
	);
}
