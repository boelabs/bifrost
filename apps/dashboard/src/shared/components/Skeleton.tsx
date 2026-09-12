import type { CSSProperties } from "react";
import { cn } from "cn";

/**
 * The placeholder every streaming boundary in the dashboard falls back to.
 *
 * A skeleton earns its place only when it occupies the same space as the thing it stands in for —
 * otherwise it trades a blank pause for a layout jump, which reads worse. So these are always built
 * from the real component's own classes, and the page-shaped ones below take the real headers and
 * counts as arguments rather than inventing their own.
 *
 * `aria-hidden` throughout: the boundary's own `role="status"` announces the wait once. A screen
 * reader has no use for thirty pulsing rectangles.
 */
export function Skeleton({
	className,
	width,
	style,
}: {
	className?: string;
	width?: string;
	style?: CSSProperties;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"block h-4 animate-pulse rounded-[var(--ui-radius-control)] bg-fg/10 motion-reduce:animate-none",
				className,
			)}
			style={width ? { width, ...style } : style}
		/>
	);
}

/**
 * A `DataTable` waiting for its rows.
 *
 * It renders the *real* column headers, so the only thing that changes when the data lands is the
 * content of the cells — the frame, the header row and the row height are already final.
 *
 * `toolbar` and `pagination` mirror the two rows `DataTable` grows when it is given those props.
 * They matter more than they look: a table that arrives with a CSV button above it and a page
 * control below it is taller than this placeholder, and the difference is a visible jump. Pass them
 * whenever the real table has them.
 */
export function TableSkeleton({
	headers,
	rows = 8,
	widths,
	toolbar = false,
	pagination = false,
}: {
	headers: readonly string[];
	rows?: number;
	/** Per-column filler width, defaulting to a readable mixture. */
	widths?: readonly string[];
	/** The real table passes `toolbar`, so it draws a row above the frame. */
	toolbar?: boolean;
	/** The real table passes `pagination`, so it draws a row below the frame. */
	pagination?: boolean;
}) {
	const fill = (index: number) =>
		widths?.[index] ?? ["70%", "45%", "60%", "35%", "55%"][index % 5] ?? "50%";
	return (
		<div
			role="status"
			aria-label="Loading rows"
			aria-busy="true"
			className="min-w-0 rounded-[var(--ui-radius-surface)] p-1"
		>
			{toolbar ? (
				<div className="flex flex-wrap items-center gap-3 p-3">
					<Skeleton
						className="ml-auto h-8 rounded-[var(--ui-radius-control)]"
						width="4.5rem"
					/>
				</div>
			) : null}
			<div className="relative overflow-x-auto rounded-[max(0px,calc(var(--ui-radius-surface)-0.25rem))] border border-border/50 bg-card">
				<table className="w-full border-collapse text-sm">
					<thead className="border-b border-border/50">
						<tr>
							{headers.map((header, index) => (
								<th
									// Headers are a fixed list per page, and a blank one is legitimate (action columns).
									// biome-ignore lint/suspicious/noArrayIndexKey: position is the only identity here
									key={`${header}-${index}`}
									scope="col"
									className="whitespace-nowrap px-4 py-3 text-left font-medium text-fg-muted text-xs"
								>
									{header}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{Array.from({ length: rows }, (_, row) => (
							<tr
								// biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
								key={row}
								className="border-b border-border/30 last:border-0"
							>
								{headers.map((header, column) => (
									<td
										// biome-ignore lint/suspicious/noArrayIndexKey: position is the only identity here
										key={`${header}-${column}`}
										className="px-4 py-3 align-middle"
									>
										<Skeleton width={fill(column)} />
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{pagination ? (
				<div className="flex flex-wrap items-center justify-between gap-3 p-3">
					<Skeleton className="h-5" width="9rem" />
					<div className="flex flex-wrap items-center gap-3">
						<Skeleton
							className="h-8 rounded-[var(--ui-radius-control)]"
							width="8rem"
						/>
						<Skeleton
							className="h-8 rounded-[var(--ui-radius-control)]"
							width="10rem"
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}

/** The frame a `Card` draws, so a placeholder can sit exactly where one will. */
const CARD =
	"rounded-[var(--ui-radius-surface)] border border-border/50 bg-card";

/**
 * A row of summary tiles, laid out and padded like `MetricCard`: label and icon, the big number,
 * a caption, and the divided footer row that gives the card its height.
 */
export function StatGridSkeleton({
	count,
	className,
}: {
	count: number;
	className?: string;
}) {
	return (
		<div
			role="status"
			aria-label="Loading summary"
			aria-busy="true"
			className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}
		>
			{Array.from({ length: count }, (_, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: placeholder tiles have no identity
				<div key={index} className={cn(CARD, "flex min-w-0 flex-col p-5")}>
					<div className="flex items-center justify-between gap-3">
						<Skeleton className="h-3.5" width="45%" />
						<Skeleton className="size-4.5 shrink-0 rounded-md" />
					</div>
					<Skeleton className="mt-4 h-8" width="60%" />
					<Skeleton className="mt-1.5 h-3" width="70%" />
					<div className="mt-auto pt-5">
						<div className="flex min-h-9 items-center justify-between gap-3 border-t border-border/50 pt-3">
							<Skeleton className="h-3" width="40%" />
							<Skeleton className="h-3" width="20%" />
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

/** A chart panel, holding its own height so the page below it never jumps. */
export function ChartSkeleton({
	height = "16rem",
	title = true,
}: {
	height?: string;
	title?: boolean;
}) {
	return (
		<div
			role="status"
			aria-label="Loading chart"
			aria-busy="true"
			className={cn(CARD, "min-w-0 p-5")}
		>
			{title ? (
				<>
					<Skeleton className="h-5" width="35%" />
					<Skeleton className="mt-2 h-3" width="25%" />
				</>
			) : null}
			<Skeleton
				className={cn("rounded-[var(--ui-radius-surface)]", title && "mt-6")}
				style={{ height }}
				width="100%"
			/>
		</div>
	);
}

/** A toolbar's worth of controls: search fields, selects and buttons, at their real heights. */
export function ToolbarSkeleton({
	widths = ["9rem", "11rem"],
}: {
	widths?: readonly string[];
}) {
	return (
		<div
			role="status"
			aria-label="Loading controls"
			aria-busy="true"
			className="flex flex-wrap items-center gap-2"
		>
			{widths.map((width, index) => (
				<Skeleton
					// Keyed by position, not by width: a toolbar can legitimately hold two controls of
					// the same size, and the list never reorders.
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholder bars have no identity
					key={index}
					className="h-8 rounded-[var(--ui-radius-control)]"
					width={width}
				/>
			))}
		</div>
	);
}
