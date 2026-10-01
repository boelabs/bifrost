"use client";

import { Select, SelectItem, SearchableSelect } from "#/components/ui/select";
import { RowActions } from "#/shared/components/RowActions";
import { Frame, FrameFooter } from "#/components/ui/frame";
import { useState, type ReactNode } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Badge } from "#/components/ui/badge";
import type { Deployment } from "./common";

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
	ChevronsUpDown,
	ChevronRight,
	ChevronLeft,
	ArrowDown,
	Columns3,
	ArrowUp,
	Pencil,
	Trash2,
	Search,
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
	filterModelRows,
	type ModelSort,
	sortModelRows,
	modelRowPage,
} from "./modelTableState";

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

const COLUMNS = [
	{ key: "id", label: "Deployment ID", width: 140, visible: true },
	{ key: "publicModel", label: "Model", width: 280, visible: true },
	{ key: "adapterKey", label: "Provider", width: 120, visible: true },
	{ key: "enabled", label: "State", width: 110, visible: true },
	{ key: "createdAt", label: "Created", width: 120, visible: true },
	{ key: "updatedAt", label: "Updated", width: 120, visible: true },
	{ key: "limits", label: "Limits", width: 140, visible: false },
	{ key: "pricing", label: "Pricing override", width: 170, visible: false },
] as const;
type ColumnKey = (typeof COLUMNS)[number]["key"];
const LOADING_ROWS = ["first", "second", "third", "fourth", "fifth"];
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
		<time
			className="flex flex-col gap-1 text-xs tabular-nums"
			dateTime={value}
			title={value}
		>
			<span>{DATE_FORMAT.format(date)}</span>
			<span className="text-muted-foreground">
				{TIME_FORMAT.format(date)} UTC
			</span>
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
		if (
			["publicModel", "createdAt", "updatedAt", "pricing", "limits"].includes(
				column,
			)
		) {
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
					<span className="truncate font-medium" title={deployment.publicModel}>
						{deployment.publicModel}
					</span>
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
				<Badge className="gap-1.5 font-normal" variant="outlined">
					<span
						aria-hidden
						className={
							deployment.enabled
								? "size-1.5 rounded-full bg-success"
								: "size-1.5 rounded-full bg-muted-foreground/50"
						}
					/>
					{deployment.enabled ? "Enabled" : "Disabled"}
				</Badge>
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
	const [sorting, setSorting] = useState<{
		key: ModelSort;
		descending: boolean;
	}>({ key: "publicModel", descending: false });
	const [visibleKeys, setVisibleKeys] = useState<ColumnKey[]>(
		COLUMNS.filter((column) => column.visible).map((column) => column.key),
	);
	const columns = COLUMNS.filter((column) => visibleKeys.includes(column.key));
	const rows = sortModelRows(
		filterModelRows(deployments, filters),
		sorting.key,
		sorting.descending,
	);
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
		<Frame aria-busy={loading || undefined}>
			{loading ? (
				<span className="sr-only" role="status">
					Loading models
				</span>
			) : null}
			<div aria-hidden={loading || undefined} inert={loading || undefined}>
				<div className="flex flex-wrap items-center gap-2 p-2">
					<div className="min-w-48 flex-1 sm:max-w-80">
						<Placeholder className="w-full" loading={loading}>
							<div className="relative">
								<Search
									aria-hidden
									className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
								/>
								<Input
									aria-label="Search models and deployments"
									className="ps-8"
									onChange={(event) =>
										updateFilter("query", event.target.value)
									}
									placeholder="Search models or deployments…"
									size="sm"
									value={filters.query}
								/>
							</div>
						</Placeholder>
					</div>
					<Placeholder loading={loading}>
						<SearchableSelect
							aria-label="Filter by provider"
							clearLabel="All providers"
							items={providers.map((value) => ({ value, label: value }))}
							onValueChange={(value) => updateFilter("provider", value ?? "")}
							searchPlaceholder="Search providers…"
							size="sm"
							value={filters.provider || null}
						/>
					</Placeholder>
					<Placeholder loading={loading}>
						<Select
							aria-label="Filter by state"
							onValueChange={(value) => updateFilter("state", value ?? "")}
							size="sm"
							value={filters.state}
						>
							<SelectItem value="">All states</SelectItem>
							<SelectItem value="enabled">Enabled</SelectItem>
							<SelectItem value="disabled">Disabled</SelectItem>
						</Select>
					</Placeholder>
					{filtered ? (
						<Button
							onClick={() => {
								setFilters({ query: "", provider: "", state: "" });
								setPage(0);
							}}
							size="sm"
							variant="ghost"
						>
							Clear filters
						</Button>
					) : null}
					<div className="ms-auto">
						<Placeholder loading={loading}>
							<MenuRoot>
								<MenuTrigger render={<Button size="sm" variant="secondary" />}>
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
																: previous.filter((key) => key !== column.key),
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
					</div>
				</div>
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
							{columns.map((column) => {
								const sortable =
									column.key === "publicModel" ||
									column.key === "createdAt" ||
									column.key === "updatedAt";
								const active = sorting.key === column.key;
								let direction: "ascending" | "descending" | "none" = "none";
								let SortIcon = ChevronsUpDown;
								if (active) {
									direction = sorting.descending ? "descending" : "ascending";
									SortIcon = sorting.descending ? ArrowDown : ArrowUp;
								}
								return (
									<TableHead
										aria-sort={sortable ? direction : undefined}
										key={column.key}
									>
										{sortable ? (
											<Button
												className="-ms-2 gap-1 px-2 font-medium"
												onClick={() => {
													setSorting({
														key: column.key as ModelSort,
														descending: active ? !sorting.descending : false,
													});
													setPage(0);
												}}
												size="sm"
												variant="ghost"
											>
												{column.label}
												<SortIcon aria-hidden className="size-3.5" />
											</Button>
										) : (
											column.label
										)}
									</TableHead>
								);
							})}
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
									<TableRow className="h-14" key={deployment.id}>
										{columns.map((column) => (
											<TableCell className="max-w-0" key={column.key}>
												<CellContent
													column={column.key}
													deployment={deployment}
												/>
											</TableCell>
										))}
										<TableCell>
											<DeploymentActions {...actions} deployment={deployment} />
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
								{pagination.start}–{pagination.end} of {rows.length} deployments
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
	);
}
