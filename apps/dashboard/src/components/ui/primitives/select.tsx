"use client";

import { controlRadiusVariants } from "#/components/ui/primitives/control-radius";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cva, type VariantProps } from "class-variance-authority";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "#/shared/lib/classes";
import type * as React from "react";

import {
	ChevronsUpDownIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	CheckIcon,
} from "lucide-react";

export const Select: typeof SelectPrimitive.Root = SelectPrimitive.Root;

export const selectTriggerVariants = cva(
	"relative inline-flex min-h-9 w-full min-w-36 select-none items-center justify-between gap-2 border border-input bg-background not-dark:bg-clip-padding px-[calc(--spacing(3)-1px)] text-left text-base text-foreground shadow-xs/5 outline-none ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 data-disabled:pointer-events-none data-disabled:opacity-64 sm:min-h-8 sm:text-sm dark:bg-input/32 dark:aria-invalid:ring-destructive/24 dark:not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [[data-disabled],:focus-visible,[aria-invalid],[data-pressed]]:shadow-none",
	{
		defaultVariants: {
			size: "default",
			radius: "default",
		},
		variants: {
			radius: controlRadiusVariants,
			size: {
				default: "",
				lg: "min-h-10 sm:min-h-9",
				sm: "min-h-8 gap-1.5 px-[calc(--spacing(2.5)-1px)] sm:min-h-7",
			},
		},
	},
);

export const selectPopupVariants = cva(
	"relative h-full min-w-(--anchor-width) border bg-popover not-dark:bg-clip-padding shadow-lg/5 before:pointer-events-none before:absolute before:inset-0 before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
	{
		defaultVariants: {
			radius: "default",
		},
		variants: {
			radius: controlRadiusVariants,
		},
	},
);

const selectScrollUpArrowVariants = cva(
	"top-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:top-px before:h-[200%] before:bg-linear-to-b before:from-50% before:from-popover",
	{
		defaultVariants: {
			radius: "default",
		},
		variants: {
			radius: {
				default: "before:rounded-t-[calc(var(--radius-lg)-1px)]",
				none: "before:rounded-t-none",
				sm: "before:rounded-t-[calc(var(--radius-sm)-1px)]",
				md: "before:rounded-t-[calc(var(--radius-md)-1px)]",
				lg: "before:rounded-t-[calc(var(--radius-lg)-1px)]",
				xl: "before:rounded-t-[calc(var(--radius-xl)-1px)]",
				full: "before:rounded-t-full",
			},
		},
	},
);

const selectScrollDownArrowVariants = cva(
	"bottom-0 z-50 flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:bottom-px before:h-[200%] before:bg-linear-to-t before:from-50% before:from-popover",
	{
		defaultVariants: {
			radius: "default",
		},
		variants: {
			radius: {
				default: "before:rounded-b-[calc(var(--radius-lg)-1px)]",
				none: "before:rounded-b-none",
				sm: "before:rounded-b-[calc(var(--radius-sm)-1px)]",
				md: "before:rounded-b-[calc(var(--radius-md)-1px)]",
				lg: "before:rounded-b-[calc(var(--radius-lg)-1px)]",
				xl: "before:rounded-b-[calc(var(--radius-xl)-1px)]",
				full: "before:rounded-b-full",
			},
		},
	},
);

export const selectTriggerIconClassName = "-me-1 size-4.5 opacity-80 sm:size-4";

export interface SelectButtonProps extends useRender.ComponentProps<"button"> {
	size?: VariantProps<typeof selectTriggerVariants>["size"];
	radius?: VariantProps<typeof selectTriggerVariants>["radius"];
}

export function SelectButton({
	className,
	size,
	render,
	radius,
	children,
	...props
}: SelectButtonProps): React.ReactElement {
	const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] =
		render ? undefined : "button";

	const defaultProps = {
		children: (
			<>
				<span className="flex-1 truncate in-data-placeholder:text-muted-foreground/72">
					{children}
				</span>
				<ChevronsUpDownIcon className={selectTriggerIconClassName} />
			</>
		),
		className: cn(
			selectTriggerVariants({ size, radius }),
			"min-w-0",
			className,
		),
		"data-slot": "select-button",
		type: typeValue,
	};

	return useRender({
		defaultTagName: "button",
		props: mergeProps<"button">(defaultProps, props),
		render,
	});
}

export function SelectTrigger({
	className,
	size = "default",
	children,
	radius,
	...props
}: SelectPrimitive.Trigger.Props &
	VariantProps<typeof selectTriggerVariants>): React.ReactElement {
	return (
		<SelectPrimitive.Trigger
			className={cn(selectTriggerVariants({ size, radius }), className)}
			data-slot="select-trigger"
			{...props}
		>
			{children}
			<SelectPrimitive.Icon data-slot="select-icon">
				<ChevronsUpDownIcon className={selectTriggerIconClassName} />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

export function SelectValue({
	className,
	...props
}: SelectPrimitive.Value.Props): React.ReactElement {
	return (
		<SelectPrimitive.Value
			className={cn(
				"flex-1 truncate data-placeholder:text-muted-foreground",
				className,
			)}
			data-slot="select-value"
			{...props}
		/>
	);
}

export function SelectPopup({
	className,
	children,
	side = "bottom",
	sideOffset = 4,
	align = "center",
	alignOffset = 0,
	alignItemWithTrigger = true,
	anchor,
	radius,
	...props
}: SelectPrimitive.Popup.Props & {
	side?: SelectPrimitive.Positioner.Props["side"];
	sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
	align?: SelectPrimitive.Positioner.Props["align"];
	alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
	alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
	anchor?: SelectPrimitive.Positioner.Props["anchor"];
} & VariantProps<typeof selectPopupVariants>): React.ReactElement {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				align={align}
				alignItemWithTrigger={alignItemWithTrigger}
				alignOffset={alignOffset}
				anchor={anchor}
				className="z-50 select-none"
				data-slot="select-positioner"
				side={side}
				sideOffset={sideOffset}
			>
				<SelectPrimitive.Popup
					className="origin-(--transform-origin) text-foreground outline-none"
					data-slot="select-popup"
					{...props}
				>
					<SelectPrimitive.ScrollUpArrow
						className={selectScrollUpArrowVariants({ radius })}
						data-slot="select-scroll-up-arrow"
					>
						<ChevronUpIcon className="relative size-4.5 sm:size-4" />
					</SelectPrimitive.ScrollUpArrow>
					<div className={selectPopupVariants({ radius })}>
						<SelectPrimitive.List
							className={cn(
								"max-h-(--available-height) overflow-y-auto p-1 [scrollbar-gutter:stable]",
								className,
							)}
							data-slot="select-list"
						>
							{children}
						</SelectPrimitive.List>
					</div>
					<SelectPrimitive.ScrollDownArrow
						className={selectScrollDownArrowVariants({ radius })}
						data-slot="select-scroll-down-arrow"
					>
						<ChevronDownIcon className="relative size-4.5 sm:size-4" />
					</SelectPrimitive.ScrollDownArrow>
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

export function SelectItem({
	className,
	children,
	...props
}: SelectPrimitive.Item.Props): React.ReactElement {
	return (
		<SelectPrimitive.Item
			className={cn(
				"grid min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)-4px)] cursor-default grid-cols-[1fr_1rem] items-center gap-2 rounded-sm py-1 ps-2 pe-2 text-base outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				className,
			)}
			data-slot="select-item"
			{...props}
		>
			<SelectPrimitive.ItemText className="col-start-1 min-w-0">
				{children}
			</SelectPrimitive.ItemText>
			<SelectPrimitive.ItemIndicator className="col-start-2">
				<CheckIcon className="size-4" />
			</SelectPrimitive.ItemIndicator>
		</SelectPrimitive.Item>
	);
}

export function SelectSeparator({
	className,
	...props
}: SelectPrimitive.Separator.Props): React.ReactElement {
	return (
		<SelectPrimitive.Separator
			className={cn("mx-2 my-1 h-px bg-border", className)}
			data-slot="select-separator"
			{...props}
		/>
	);
}

export function SelectGroup(
	props: SelectPrimitive.Group.Props,
): React.ReactElement {
	return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

export function SelectLabel({
	className,
	...props
}: SelectPrimitive.Label.Props): React.ReactElement {
	return (
		<SelectPrimitive.Label
			className={cn(
				"not-in-data-[slot=field]:mb-2 inline-flex cursor-default items-center gap-2 font-medium text-base/4.5 text-foreground sm:text-sm/4",
				className,
			)}
			data-slot="select-label"
			{...props}
		/>
	);
}

export function SelectGroupLabel(
	props: SelectPrimitive.GroupLabel.Props,
): React.ReactElement {
	return (
		<SelectPrimitive.GroupLabel
			className="px-2 py-1.5 font-medium text-muted-foreground text-xs"
			data-slot="select-group-label"
			{...props}
		/>
	);
}

export type NativeSelectProps = Omit<
	React.SelectHTMLAttributes<HTMLSelectElement>,
	"size"
> &
	VariantProps<typeof selectTriggerVariants>;

export function NativeSelect({
	className,
	size,
	radius,
	children,
	...props
}: NativeSelectProps): React.ReactElement {
	return (
		<span className="relative block w-full">
			<select
				className={cn(
					selectTriggerVariants({ size, radius }),
					"appearance-none pe-9 [&::-ms-expand]:hidden [&>option]:bg-popover [&>option]:text-popover-foreground",
					className,
				)}
				data-slot="native-select"
				{...props}
			>
				{children}
			</select>
			<ChevronsUpDownIcon
				aria-hidden="true"
				className={cn(
					selectTriggerIconClassName,
					"pointer-events-none absolute inset-e-3 top-1/2 -translate-y-1/2",
				)}
			/>
		</span>
	);
}

export { SelectPopup as SelectContent };
export { Select as SelectPrimitive } from "@base-ui/react/select";
