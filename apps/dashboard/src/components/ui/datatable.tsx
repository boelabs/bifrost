"use client";

import { TextSkeleton } from "#/shared/components/TextSkeleton";
import { Select, SelectItem } from "./select";
import { Button } from "./button";
import { Input } from "./input";
import Link from "next/link";
import { cn } from "cn";

import {
	ChevronRight as IconChevronRight,
	ChevronLeft as IconChevronLeft,
	ChevronDown as IconChevronDown,
	ChevronsUpDown as IconSelector,
	ChevronUp as IconChevronUp,
} from "lucide-react";

import {
	type AppearanceProps,
	type EffectProps,
	appearanceStyle,
	effectClassName,
} from "./appearance";

import {
	TableHeader,
	TableBody,
	TableHead,
	TableCell,
	TableRow,
	Table,
} from "./primitives/table";

import {
	type CSSProperties,
	type ReactNode,
	useEffect,
	useState,
	useId,
} from "react";

/** Above this many columns a phone shows each row as a card (`[data-stack]` in styles.css). */
const MAX_PHONE_COLUMNS = 3;

/** What a stacked row prints beside a cell: its header, when the header is text. */
function headerLabel(header: ReactNode): string {
	return typeof header === "string" ? header : "";
}

/** The three values `aria-sort` takes on a sortable column header. */
type SortDirection = "ascending" | "descending" | "none";

const SORT_ICONS: Record<SortDirection, typeof IconSelector> = {
	ascending: IconChevronUp,
	descending: IconChevronDown,
	none: IconSelector,
};

export interface Column<T> {
	key: string;
	header: ReactNode;
	align?: "end";
	render: (row: T) => ReactNode;
	placeholder?: ReactNode;
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
	/**
	 * The page a row opens, or `null` for a row without one. The first column's content becomes the
	 * row's link, stretched over the whole row; links and buttons in the other cells stay above it.
	 */
	rowHref?: (row: T) => string | null;
}

/** Raises a row's own controls above its stretched link. */
const ABOVE_ROW_LINK =
	"[&_:is(a,button,input,select,textarea)]:relative [&_:is(a,button,input,select,textarea)]:z-10";

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
	rowHref,
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
	/** What the body says when it has no rows to show. */
	const placeholder = loading ? "Loading..." : emptyMessage;
	return (
		<div
			aria-busy={loading}
			className={cn(
				"min-w-0 rounded-(--ui-radius-surface)",
				framed && "bg-muted/72 p-1",
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
					{search ? (
						<div className="w-full sm:w-64">
							<Input
								aria-label={search.placeholder ?? "Search table"}
								onValueChange={(value) => {
									setQuery(value);
									setPage(0);
								}}
								placeholder={search.placeholder ?? "Search..."}
								type="search"
								value={query}
							/>
						</div>
					) : null}
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
							type="button"
							variant="ghost"
						>
							Clear filters
						</Button>
					)}
					{toolbar ? (
						<div className="ml-auto flex flex-wrap items-center gap-2">
							{toolbar}
						</div>
					) : null}
				</div>
			)}
			{/* Contain the absolutely positioned screen-reader caption while scrolling. */}
			<div
				className={cn("relative overflow-x-auto", framed && "rounded-xl")}
				style={
					{
						borderRadius: radius,
						"--table-radius":
							typeof radius === "number" ? `${radius}px` : radius,
					} as CSSProperties
				}
			>
				<Table
					// More columns than fit a phone: there each row reads as a card (`data-stack`).
					data-stack={columns.length > MAX_PHONE_COLUMNS ? "" : undefined}
					id={id}
					variant={framed ? "card" : "default"}
				>
					{caption ? <caption className="sr-only">{caption}</caption> : null}
					<TableHeader>
						<TableRow>
							{columns.map((column) => {
								const active = sorting?.key === column.key;
								// One direction drives both the icon and aria-sort, so a header can
								// never say one thing to the eye and another to a screen reader.
								let direction: SortDirection = "none";
								if (active) {
									direction = sorting.descending ? "descending" : "ascending";
								}
								const SortIcon = SORT_ICONS[direction];
								return (
									<TableHead
										aria-sort={column.compare ? direction : undefined}
										className={cn(
											"text-left",
											column.align === "end" && "text-right",
										)}
										key={column.key}
										scope="col"
									>
										{column.compare ? (
											<Button
												className={cn(
													// Billete's headers are plain text: a sortable one looks the same, and its
													// arrows appear on the sorted column or under the pointer.
													"group/sort -mx-2 h-auto gap-1 px-2 py-1 font-[inherit] text-[length:inherit] text-inherit hover:bg-transparent hover:text-foreground sm:h-auto",
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
												<SortIcon
													aria-hidden
													className={cn(
														"size-3.5",
														!active &&
															"opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60",
													)}
												/>
											</Button>
										) : (
											column.header
										)}
									</TableHead>
								);
							})}
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading
							? Array.from({ length: 8 }, (_, index) => (
									<TableRow
										aria-hidden="true"
										// biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder positions have no record identity
										key={`loading-${index}`}
									>
										{columns.map((column) => (
											<TableCell
												className={cn(
													column.align === "end" && "text-right tabular-nums",
												)}
												data-label={headerLabel(column.header)}
												key={column.key}
											>
												{column.placeholder ?? <TextSkeleton length={16} />}
											</TableCell>
										))}
									</TableRow>
								))
							: visible.map((row) => {
									const href = rowHref?.(row) ?? null;
									return (
										<TableRow
											className={cn(href && "relative cursor-pointer")}
											key={rowKey(row)}
										>
											{columns.map((column, index) => (
												<TableCell
													className={cn(
														"p-2.5 align-middle text-fg",
														column.align === "end" && "text-right tabular-nums",
														href && index > 0 && ABOVE_ROW_LINK,
													)}
													data-label={headerLabel(column.header)}
													key={column.key}
												>
													{href && index === 0 ? (
														<Link
															className="outline-none after:absolute after:inset-0 after:rounded-[inherit] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
															href={href}
														>
															{column.render(row)}
														</Link>
													) : (
														column.render(row)
													)}
												</TableCell>
											))}
										</TableRow>
									);
								})}
						{!loading && visible.length === 0 && (
							// An empty state brings its own spacing, as Billete's table does: only plain
							// text gets the cell's padding.
							<TableRow data-empty="">
								<TableCell
									className={cn(
										"whitespace-normal text-center text-fg-muted",
										typeof placeholder === "string" ? "px-5 py-12" : "p-0",
									)}
									colSpan={Math.max(columns.length, 1)}
								>
									<div role="status">{placeholder}</div>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			{pagination ? (
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
			) : null}
		</div>
	);
}

export const Mono = ({ children }: { children: ReactNode }) => (
	<span className="font-mono text-fg-muted text-xs">{children}</span>
);
export const Dash = () => <span className="text-fg-muted">—</span>;
