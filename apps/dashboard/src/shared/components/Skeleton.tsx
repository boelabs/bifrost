"use client";

import { Skeleton as PrimitiveSkeleton } from "#/components/ui/primitives/skeleton";
import { Frame, FramePanel, FrameFooter } from "#/components/ui/frame";
import { Button, type ButtonProps } from "#/components/ui/button";
import { TextSkeleton, placeholderText } from "./TextSkeleton";
import { Select, SelectItem } from "#/components/ui/select";
import type { CSSProperties, ReactNode } from "react";
import { DataTable } from "#/components/ui/datatable";
import { ContentPanel } from "#/components/ui/card";
import { Badge } from "#/components/ui/badge";
import { cn } from "#/shared/lib/classes";

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
		<PrimitiveSkeleton
			aria-hidden="true"
			className={cn("block h-4 max-w-full", className)}
			render={<span />}
			style={width ? { width, ...style } : style}
		/>
	);
}
export function ButtonSkeleton({
	size = "sm",
	label = 10,
	width,
	mode,
}: {
	size?: ButtonProps["size"];
	label?: number;
	width?: string;
	mode?: ButtonProps["mode"];
}) {
	return (
		<PrimitiveSkeleton
			aria-hidden="true"
			className="flex w-fit rounded-lg"
			style={width ? { width } : undefined}
		>
			<span className="invisible contents">
				<Button
					className={width ? "w-full" : undefined}
					mode={mode}
					size={size}
					tabIndex={-1}
				>
					{placeholderText(label)}
				</Button>
			</span>
		</PrimitiveSkeleton>
	);
}
export function GhostSkeleton({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<PrimitiveSkeleton
			aria-hidden="true"
			className={cn("flex w-fit rounded-lg", className)}
		>
			<span className="invisible contents">{children}</span>
		</PrimitiveSkeleton>
	);
}
export function TableSkeleton({
	headers,
	rows = 8,
	widths,
	toolbar = false,
	pagination = false,
	plain = false,
}: {
	headers: readonly string[];
	rows?: number;
	widths?: readonly string[];
	toolbar?: boolean;
	pagination?: boolean;
	plain?: boolean;
}) {
	return (
		<div
			aria-busy="true"
			aria-label="Loading rows"
			className="min-w-0"
			role="status"
		>
			<DataTable
				columns={headers.map((header, index) => ({
					key: String(index),
					header,
					render: () => {
						if (header === "Role") {
							return (
								<GhostSkeleton>
									<Select disabled value="owner">
										<SelectItem value="owner">owner</SelectItem>
									</Select>
								</GhostSkeleton>
							);
						}
						if (header === "") {
							return <ButtonSkeleton label={0} mode="icon" />;
						}
						if (
							["State", "Result", "Kind", "Outcome", "Catalog"].includes(header)
						) {
							return (
								<GhostSkeleton className="rounded-sm">
									<Badge variant="neutral">enabled</Badge>
								</GhostSkeleton>
							);
						}
						if (header === "Total tokens") {
							return (
								<div className="flex flex-col gap-1">
									<TextSkeleton length={9} />
									<span className="text-xs">
										<TextSkeleton length={20} />
									</span>
								</div>
							);
						}
						return <Skeleton width={widths?.[index] ?? "70%"} />;
					},
				}))}
				pagination={pagination ? { pageSize: rows } : false}
				rowKey={(row) => String(row)}
				rows={Array.from({ length: rows }, (_, index) => index)}
				toolbar={toolbar ? <ButtonSkeleton label={3} /> : undefined}
				variant={plain ? "plain" : "framed"}
			/>
		</div>
	);
}
const GRID_COLUMNS: Record<number, string> = {
	1: "grid-cols-1",
	2: "grid-cols-2",
	3: "grid-cols-1 sm:grid-cols-3",
	4: "grid-cols-2 lg:grid-cols-4",
};
export function StatGridSkeleton({
	count,
	className,
	icon = true,
	note = true,
}: {
	count: number;
	className?: string;
	icon?: boolean;
	note?: boolean;
}) {
	return (
		<div
			aria-busy="true"
			aria-label="Loading summary"
			className={cn("grid gap-3", GRID_COLUMNS[Math.min(count, 4)], className)}
			role="status"
		>
			{Array.from({ length: count }, (_, index) => (
				<Frame
					className="min-w-0"
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder positions have no record identity
					key={`stat-${index}`}
				>
					<FramePanel className="flex flex-1 flex-col gap-2 p-4">
						<div className="flex items-start justify-between gap-2">
							<span className="text-muted-foreground text-xs">
								<TextSkeleton length={14} />
							</span>
							{icon ? <Skeleton className="size-4 shrink-0" /> : null}
						</div>
						<span className="font-semibold text-2xl tabular-nums">
							<TextSkeleton length={7} />
						</span>
					</FramePanel>
					<FrameFooter className="flex min-w-0 items-center gap-2 px-3 pt-2 pb-1.5 text-muted-foreground text-xs">
						{note ? (
							<Skeleton className="h-4.5 w-14 shrink-0 rounded-sm" />
						) : null}
						<TextSkeleton length={18} />
					</FrameFooter>
				</Frame>
			))}
		</div>
	);
}
export function ChartSkeleton({
	height = "16rem",
	title = true,
}: {
	height?: string;
	title?: boolean;
}) {
	return (
		<ContentPanel
			aria-busy="true"
			aria-label="Loading chart"
			className="min-w-0 p-5"
			role="status"
		>
			{title ? (
				<div className="flex flex-col gap-1">
					<span className="font-semibold text-sm">
						<TextSkeleton length={18} />
					</span>
					<span className="text-muted-foreground text-xs">
						<TextSkeleton length={30} />
					</span>
				</div>
			) : null}
			<Skeleton
				className={cn("rounded-xl", title && "mt-6")}
				style={{ height }}
				width="100%"
			/>
		</ContentPanel>
	);
}
export function ToolbarSkeleton({
	widths = ["9rem", "11rem"],
}: {
	widths?: readonly string[];
}) {
	return (
		<div
			aria-busy="true"
			aria-label="Loading controls"
			className="flex flex-wrap items-center gap-2"
			role="status"
		>
			{widths.map((width, index) => (
				<ButtonSkeleton
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed placeholder positions have no record identity
					key={`control-${index}`}
					width={width}
				/>
			))}
		</div>
	);
}

/** The actual form fixes geometry; inert controls cannot submit or receive focus. */
export function FormSkeleton({ children }: { children: ReactNode }) {
	return (
		<div aria-hidden="true" data-skeleton-form="" inert>
			{children}
		</div>
	);
}
