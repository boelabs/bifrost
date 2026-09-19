"use client";

import { Select, SelectItem } from "./select";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "cn";

import {
	IconChevronRight,
	IconChevronLeft,
	IconChevronDown,
	IconChevronUp,
	IconSelector,
} from "@tabler/icons-react";

import {
	type AppearanceProps,
	type EffectProps,
	appearanceStyle,
	effectClassName,
} from "./appearance";

import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useState,
	useId,
} from "react";

export interface Column<T> {
	key: string;
	header: ReactNode;
	align?: "end";
	render: (row: T) => ReactNode;
	/** Enables sorting with a comparator for the underlying values. */
	compare?: (a: T, b: T) => number;
}

export interface DataTableFilter<T> {
	key: string;
	label: string;
	options: readonly { value: string; label: string }[];
	getValue: (row: T) => string;
}

export interface DataTableProps<T> extends AppearanceProps, EffectProps {
	rows: readonly T[];
	columns: readonly Column<T>[];
	rowKey: (row: T) => string;
	caption?: string;
	className?: string;
	style?: CSSProperties;
	search?: { getText: (row: T) => string; placeholder?: string };
	filters?: readonly DataTableFilter<T>[];
	toolbar?: ReactNode;
	/**
	 * `framed` draws the table's own card. `plain` removes it, for a table that already sits inside
	 * one — two nested surfaces read as a box in a box rather than as one panel.
	 */
	variant?: "framed" | "plain";
	/** Client pagination over the complete rows collection; disabled by default. */
	pagination?: false | { pageSize?: number };
	loading?: boolean;
	emptyMessage?: ReactNode;
}

export function DataTable<T>({
	rows,
	columns,
	rowKey,
	caption,
	borderRadius,
	width,
	className,
	style,
	effect = null,
	search,
	filters = [],
	toolbar,
	variant = "framed",
	pagination = false,
	loading = false,
	emptyMessage = "No results found.",
}: DataTableProps<T>) {
	const id = useId();
	const [query, setQuery] = useState("");
	const [filterValues, setFilterValues] = useState<
		Record<string, string | null>
	>({});
	const [sorting, setSorting] = useState<{
		key: string;
		descending: boolean;
	} | null>(null);
	const [page, setPage] = useState(0);
	const [selectedPageSize, setSelectedPageSize] = useState<number>();
	const requestedSize =
		selectedPageSize ?? (pagination ? (pagination.pageSize ?? 10) : 10);
	const pageSize =
		Number.isSafeInteger(requestedSize) && requestedSize > 0
			? requestedSize
			: 10;
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const filtered = rows.filter(
		(row) =>
			(!(search && normalizedQuery) ||
				search.getText(row).toLocaleLowerCase().includes(normalizedQuery)) &&
			filters.every(
				(filter) =>
					filterValues[filter.key] == null ||
					filter.getValue(row) === filterValues[filter.key],
			),
	);
	const compare =
		sorting && columns.find((column) => column.key === sorting.key)?.compare;
	if (compare) {
		filtered.sort((a, b) => compare(a, b) * (sorting?.descending ? -1 : 1));
	}
	const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
	const currentPage = Math.min(page, pageCount - 1);
	useEffect(() => {
		if (page !== currentPage) {
			setPage(currentPage);
		}
	}, [page, currentPage]);
	const visible = pagination
		? filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
		: filtered;
	const hasFilters = Boolean(
		query || filters.some((filter) => filterValues[filter.key] != null),
	);
	const sizes = [...new Set([10, 25, 50, pageSize])].sort((a, b) => a - b);
	const frameStyle = appearanceStyle({ borderRadius, width }, style);
	const radius = frameStyle.borderRadius ?? "var(--ui-radius-surface)";
	const framed = variant === "framed";
	return (
		<div
			aria-busy={loading}
			className={cn(
				"min-w-0 rounded-[var(--ui-radius-surface)]",
				framed && "p-1",
				effectClassName(effect),
				className,
			)}
			style={frameStyle}
		>
			{(search || filters.length > 0 || toolbar) && (
				<div
					className={cn(
						"flex flex-wrap items-center gap-3",
						framed ? "p-3" : "pb-4",
					)}
				>
					{search && (
						<div className="w-full sm:w-64">
							<Input
								aria-label={search.placeholder ?? "Search table"}
								onValueChange={(value) => {
									setQuery(value);
									setPage(0);
								}}
								placeholder={search.placeholder ?? "Search..."}
								size="sm"
								type="search"
								value={query}
							/>
						</div>
					)}
					{filters.map((filter) => (
						<Select
							aria-label={filter.label}
							key={filter.key}
							onValueChange={(value) => {
								setFilterValues((previous) => ({
									...previous,
									[filter.key]: value,
								}));
								setPage(0);
							}}
							placeholder={`All ${filter.label.toLowerCase()}`}
							size="sm"
							value={filterValues[filter.key] ?? null}
						>
							<SelectItem value={null}>
								All {filter.label.toLowerCase()}
							</SelectItem>
							{filter.options.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</Select>
					))}
					{hasFilters && (
						<Button
							onClick={() => {
								setQuery("");
								setFilterValues({});
								setPage(0);
							}}
							size="sm"
							type="button"
							variant="ghost"
						>
							Clear filters
						</Button>
					)}
					{toolbar && (
						<div className="ml-auto flex flex-wrap items-center gap-2">
							{toolbar}
						</div>
					)}
				</div>
			)}
			{/* Contain the absolutely positioned screen-reader caption while scrolling. */}
			<div
				className={cn(
					"relative overflow-x-auto",
					framed &&
						"rounded-[max(0px,calc(var(--table-radius)-0.25rem))] border border-border/50 bg-card",
				)}
				style={
					{
						"--table-radius":
							typeof radius === "number" ? `${radius}px` : radius,
					} as CSSProperties
				}
			>
				<table className="w-full border-collapse text-sm" id={id}>
					{caption && <caption className="sr-only">{caption}</caption>}
					<thead className="border-border/50 border-b">
						<tr>
							{columns.map((column) => {
								const active = sorting?.key === column.key;
								const SortIcon = active
									? sorting.descending
										? IconChevronDown
										: IconChevronUp
									: IconSelector;
								return (
									<th
										aria-sort={
											column.compare
												? active
													? sorting.descending
														? "descending"
														: "ascending"
													: "none"
												: undefined
										}
										className={cn(
											"whitespace-nowrap px-5 py-4 text-left font-medium text-fg-muted text-xs",
											column.align === "end" && "text-right",
										)}
										key={column.key}
										scope="col"
									>
										{column.compare ? (
											<Button
												className={cn(
													"-mx-2 gap-1 px-2 font-medium text-xs",
													column.align === "end" && "ml-auto",
												)}
												onClick={() => {
													setSorting({
														key: column.key,
														descending: active ? !sorting.descending : false,
													});
													setPage(0);
												}}
												size="xs"
												type="button"
												variant="ghost"
											>
												{column.header}
												<SortIcon aria-hidden className="size-3.5" />
											</Button>
										) : (
											column.header
										)}
									</th>
								);
							})}
						</tr>
					</thead>
					<tbody>
						{visible.map((row) => (
							<tr
								className="border-border/30 border-b last:border-0 hover:bg-surface-2/40"
								key={rowKey(row)}
							>
								{columns.map((column) => (
									<td
										className={cn(
											"px-5 py-4 align-middle text-fg",
											column.align === "end" && "text-right",
										)}
										key={column.key}
									>
										{column.render(row)}
									</td>
								))}
							</tr>
						))}
						{visible.length === 0 && (
							<tr>
								<td
									className="px-5 py-12 text-center text-fg-muted"
									colSpan={Math.max(columns.length, 1)}
								>
									<span role="status">
										{loading ? "Loading..." : emptyMessage}
									</span>
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
			{pagination && (
				<div
					className={cn(
						"flex flex-wrap items-center justify-between gap-3",
						framed ? "p-3" : "pt-4",
					)}
				>
					<p className="text-fg-muted text-sm" role="status">
						{filtered.length ? currentPage * pageSize + 1 : 0}–
						{Math.min((currentPage + 1) * pageSize, filtered.length)} of{" "}
						{filtered.length} results
					</p>
					<div className="flex flex-wrap items-center gap-3">
						<Select
							aria-label="Rows per page"
							onValueChange={(value) => {
								if (value != null) {
									setSelectedPageSize(value);
									setPage(0);
								}
							}}
							size="sm"
							value={pageSize}
						>
							{sizes.map((size) => (
								<SelectItem key={size} value={size}>
									{size} per page
								</SelectItem>
							))}
						</Select>
						<nav
							aria-label={
								caption ? `${caption} pagination` : "Table pagination"
							}
							className="flex items-center gap-2"
						>
							<Button
								aria-controls={id}
								aria-label="Previous page"
								disabled={loading || currentPage === 0}
								onClick={() => setPage(currentPage - 1)}
								size="sm"
								type="button"
								variant="ghost"
							>
								<IconChevronLeft aria-hidden className="size-4" />
							</Button>
							<span className="text-fg-muted text-sm tabular-nums">
								{currentPage + 1} / {pageCount}
							</span>
							<Button
								aria-controls={id}
								aria-label="Next page"
								disabled={loading || currentPage >= pageCount - 1}
								onClick={() => setPage(currentPage + 1)}
								size="sm"
								type="button"
								variant="ghost"
							>
								<IconChevronRight aria-hidden className="size-4" />
							</Button>
						</nav>
					</div>
				</div>
			)}
		</div>
	);
}

export const Mono = ({ children }: { children: ReactNode }) => (
	<span className="font-mono text-fg-muted text-xs">{children}</span>
);
export const Dash = () => <span className="text-fg-muted">—</span>;
