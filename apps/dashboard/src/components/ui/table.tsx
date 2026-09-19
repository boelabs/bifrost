import { type AppearanceProps, appearanceStyle } from "./appearance.ts";
import type { ComponentProps } from "react";
import { cn } from "cn";

export interface TableProps
	extends Omit<ComponentProps<"table">, "width">,
		AppearanceProps {}

// Base UI has no data-grid primitive. Keep read-only tables semantic instead of emulating a grid.
export function Table({
	borderRadius,
	width,
	style,
	className,
	...props
}: TableProps) {
	return (
		<table
			{...props}
			className={cn(
				"w-full border-separate border-spacing-0 rounded-(--ui-radius-surface) border border-border text-sm",
				className,
			)}
			style={appearanceStyle({ borderRadius, width }, style)}
		/>
	);
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
	return (
		<thead
			{...props}
			className={cn("bg-surface-2/50 text-fg-muted", className)}
		/>
	);
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
	return (
		<tbody {...props} className={cn("divide-y divide-border/30", className)} />
	);
}

export function TableRow({ className, ...props }: ComponentProps<"tr">) {
	return (
		<tr
			{...props}
			className={cn(
				"text-fg transition-colors hover:bg-surface-2/40",
				className,
			)}
		/>
	);
}

export function TableColumn({
	className,
	scope = "col",
	...props
}: ComponentProps<"th">) {
	return (
		<th
			{...props}
			className={cn(
				"border-border/50 border-b px-4 py-3 text-left font-medium text-xs",
				className,
			)}
			scope={scope}
		/>
	);
}

export function TableCell({ className, ...props }: ComponentProps<"td">) {
	return (
		<td
			{...props}
			className={cn(
				"border-border/30 border-b px-4 py-3 align-middle",
				className,
			)}
		/>
	);
}

export function TableCaption({
	className,
	...props
}: ComponentProps<"caption">) {
	return (
		<caption
			{...props}
			className={cn("p-3 text-fg-muted text-sm", className)}
		/>
	);
}

export function TableFooter({ className, ...props }: ComponentProps<"tfoot">) {
	return (
		<tfoot
			{...props}
			className={cn("bg-surface-2/50 font-medium", className)}
		/>
	);
}
