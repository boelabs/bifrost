"use client";

import { Select, SelectItem, SearchableSelect } from "#/components/ui/select";
import { Skeleton, GhostSkeleton } from "#/shared/components/Skeleton";
import { filterModelGroups, modelGroupPage } from "./modelTableState";
import { RowActions } from "#/shared/components/RowActions";
import { Frame, FrameFooter } from "#/components/ui/frame";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Badge } from "#/components/ui/badge";
import type { Deployment } from "./common";
import { Fragment, useState } from "react";

import {
	TableHeader,
	TableBody,
	TableHead,
	TableCell,
	TableRow,
	Table,
} from "#/components/ui/table";

import {
	ArrowDown,
	ArrowUp,
	Pencil,
	Trash2,
	Search,
	Check,
	Ban,
} from "lucide-react";

interface ModelsTableProps {
	deployments?: Deployment[];
	writable?: boolean;
	loading?: boolean;
	onEdit?: (deployment: Deployment) => void;
	onToggle?: (deployment: Deployment) => void;
	onDelete?: (deployment: Deployment) => void;
}

const LOADING_GROUPS = [
	{ id: "first", rows: ["primary", "secondary", "backup"] },
	{ id: "second", rows: ["primary", "backup"] },
	{ id: "third", rows: ["primary"] },
];

function Placeholder({
	loading,
	children,
	className,
}: {
	loading: boolean;
	children: React.ReactNode;
	className?: string;
}) {
	return loading ? (
		<GhostSkeleton className={className}>{children}</GhostSkeleton>
	) : (
		children
	);
}

function StateBadge({
	active,
	children,
}: {
	active: boolean;
	children: React.ReactNode;
}) {
	return (
		<Badge className="gap-1.5 font-normal" variant="outlined">
			<span
				aria-hidden
				className={`size-1.5 rounded-full ${active ? "bg-success" : "bg-muted-foreground/50"}`}
			/>
			{children}
		</Badge>
	);
}

function DeploymentRow({
	deployment,
	writable,
	onEdit,
	onToggle,
	onDelete,
}: ModelsTableProps & { deployment?: Deployment }) {
	return (
		<TableRow className="h-14">
			<TableCell className="max-w-0 ps-5">
				{deployment ? (
					<div className="flex min-w-0 flex-col gap-1.5">
						<span
							className="truncate font-medium"
							title={deployment.upstreamModel}
						>
							{deployment.upstreamModel}
						</span>
						{deployment.label ? (
							<span
								className="truncate text-muted-foreground text-xs"
								title={deployment.label}
							>
								{deployment.label}
							</span>
						) : null}
					</div>
				) : (
					<div className="flex flex-col gap-1.5">
						<Skeleton className="h-3.5 w-3/5" />
						<Skeleton className="h-3 w-2/5" />
					</div>
				)}
			</TableCell>
			<TableCell>
				{deployment ? (
					<Badge className="font-normal" variant="outlined">
						{deployment.adapterKey}
					</Badge>
				) : (
					<Skeleton className="h-5 w-20 rounded-md" />
				)}
			</TableCell>
			<TableCell className="text-right tabular-nums">
				{deployment ? (
					deployment.weight
				) : (
					<Skeleton className="ms-auto h-3.5 w-6" />
				)}
			</TableCell>
			<TableCell>
				{deployment ? (
					<div className="flex flex-col gap-1.5 text-muted-foreground text-xs tabular-nums">
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
				) : (
					<Skeleton className="h-3.5 w-20" />
				)}
			</TableCell>
			<TableCell>
				{deployment ? (
					<Badge className="font-normal" variant="outlined">
						{deployment.custom ? "Custom" : "Built-in"}
					</Badge>
				) : (
					<Skeleton className="h-5 w-16 rounded-md" />
				)}
			</TableCell>
			<TableCell>
				{deployment ? (
					<StateBadge active={deployment.enabled}>
						{deployment.enabled ? "Enabled" : "Disabled"}
					</StateBadge>
				) : (
					<Skeleton className="h-5 w-20 rounded-md" />
				)}
			</TableCell>
			<TableCell className="text-right">
				{deployment && writable ? (
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
						label={`Actions for deployment ${deployment.upstreamModel}`}
					/>
				) : null}
			</TableCell>
		</TableRow>
	);
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
		catalog: "",
	});
	const [requestedPage, setPage] = useState(0);
	const [descending, setDescending] = useState(false);
	const groups = filterModelGroups(deployments, filters);
	if (descending) {
		groups.reverse();
	}
	const pagination = modelGroupPage(groups, requestedPage);
	const providers = [
		...new Set(deployments.map((row) => row.adapterKey)),
	].sort();
	const filtered = Object.values(filters).some(Boolean);
	function updateFilter(key: keyof typeof filters, value: string) {
		setFilters((previous) => ({ ...previous, [key]: value }));
		setPage(0);
	}
	const range = `${pagination.start}–${pagination.end}`;
	const deploymentCount = groups.reduce(
		(total, group) => total + group.deployments.length,
		0,
	);
	const pageOptions = Array.from(
		{ length: pagination.pageCount },
		(_, page) => ({
			value: String(page),
			label:
				groups.length > 0
					? `${page * 10 + 1}–${Math.min((page + 1) * 10, groups.length)}`
					: range,
		}),
	);
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
					<Placeholder loading={loading}>
						<Select
							aria-label="Filter by catalog"
							onValueChange={(value) => updateFilter("catalog", value ?? "")}
							size="sm"
							value={filters.catalog}
						>
							<SelectItem value="">All catalogs</SelectItem>
							<SelectItem value="built-in">Built-in</SelectItem>
							<SelectItem value="custom">Custom</SelectItem>
						</Select>
					</Placeholder>
					{filtered ? (
						<Button
							onClick={() => {
								setFilters({ query: "", provider: "", state: "", catalog: "" });
								setPage(0);
							}}
							size="sm"
							variant="ghost"
						>
							Clear filters
						</Button>
					) : null}
				</div>
				<Table
					aria-label="Public models and deployments"
					className="min-w-200 table-fixed"
					variant="card"
				>
					<TableHeader>
						<TableRow>
							<TableHead
								aria-sort={descending ? "descending" : "ascending"}
								className="w-[32%]"
							>
								<Button
									className="-ms-1"
									onClick={() => {
										setDescending(!descending);
										setPage(0);
									}}
									size="sm"
									variant="ghost"
								>
									Public model / Deployment
									{descending ? (
										<ArrowDown aria-hidden className="size-3.5" />
									) : (
										<ArrowUp aria-hidden className="size-3.5" />
									)}
								</Button>
							</TableHead>
							<TableHead className="w-[16%]">Provider</TableHead>
							<TableHead className="w-[8%] text-right">Weight</TableHead>
							<TableHead className="w-[14%]">Limits</TableHead>
							<TableHead className="w-[12%]">Catalog</TableHead>
							<TableHead className="w-[12%]">State</TableHead>
							<TableHead className="w-[6%]">
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading
							? LOADING_GROUPS.map((group) => (
									<Fragment key={group.id}>
										<TableRow className="h-12">
											<TableCell
												colSpan={7}
												style={{ backgroundColor: "var(--muted)" }}
											>
												<div className="flex items-center justify-between gap-3">
													<Skeleton className="h-4 w-40" />
													<Skeleton className="h-5 w-44 rounded-md" />
												</div>
											</TableCell>
										</TableRow>
										{group.rows.map((id) => (
											<DeploymentRow key={id} />
										))}
									</Fragment>
								))
							: pagination.groups.map((group) => (
									<Fragment key={group.publicModel}>
										<TableRow className="h-12">
											<TableCell
												colSpan={7}
												style={{ backgroundColor: "var(--muted)" }}
											>
												<div className="flex items-center justify-between gap-4">
													<div className="flex min-w-0 items-center gap-3">
														<h2
															className="truncate font-semibold text-sm"
															title={group.publicModel}
														>
															{group.publicModel}
														</h2>
														<span className="shrink-0 text-muted-foreground text-xs">
															{group.deployments.length === group.totalCount
																? `${group.totalCount} deployment${group.totalCount === 1 ? "" : "s"}`
																: `${group.deployments.length} of ${group.totalCount} deployments`}
														</span>
													</div>
													<StateBadge active={group.enabledCount > 0}>
														{group.enabledCount > 0
															? `${group.enabledCount} enabled`
															: "No enabled deployments"}
													</StateBadge>
												</div>
											</TableCell>
										</TableRow>
										{group.deployments.map((deployment) => (
											<DeploymentRow
												{...actions}
												deployment={deployment}
												key={deployment.id}
											/>
										))}
									</Fragment>
								))}
						{!loading && groups.length === 0 ? (
							<TableRow>
								<TableCell className="h-40 text-center" colSpan={7}>
									<p className="font-medium">No matching deployments</p>
									<p className="mt-2 text-muted-foreground text-sm">
										Try another search or clear the filters.
									</p>
								</TableCell>
							</TableRow>
						) : null}
					</TableBody>
				</Table>
				<FrameFooter className="flex flex-wrap items-center justify-between gap-3 p-2 text-muted-foreground text-sm">
					<Placeholder loading={loading}>
						<div className="flex flex-wrap items-center gap-2">
							<span>Viewing</span>
							<Select
								aria-label="Visible public models"
								disabled={!groups.length}
								onValueChange={(value) => setPage(Number(value ?? 0))}
								size="sm"
								value={String(pagination.page)}
							>
								{pageOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</Select>
							<span className="tabular-nums">
								of {groups.length} public models
							</span>
							<span className="text-xs tabular-nums">
								· {deploymentCount} deployment{deploymentCount === 1 ? "" : "s"}
							</span>
						</div>
					</Placeholder>
					<Placeholder loading={loading}>
						<div className="flex gap-2">
							<Button
								disabled={pagination.page === 0}
								onClick={() => setPage(pagination.page - 1)}
								size="sm"
								variant="secondary"
							>
								Previous
							</Button>
							<Button
								disabled={pagination.page + 1 >= pagination.pageCount}
								onClick={() => setPage(pagination.page + 1)}
								size="sm"
								variant="secondary"
							>
								Next
							</Button>
						</div>
					</Placeholder>
				</FrameFooter>
			</div>
		</Frame>
	);
}
