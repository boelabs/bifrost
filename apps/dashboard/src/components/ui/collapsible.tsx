"use client";

import { Collapsible as BaseCollapsible } from "@base-ui/react/collapsible";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	controlStyles,
	mergeStyle,
} from "./appearance";

export type CollapsibleRootProps = BaseCollapsible.Root.Props & AppearanceProps;
export type CollapsibleTriggerProps = BaseCollapsible.Trigger.Props &
	ControlProps;
export type CollapsiblePanelProps = BaseCollapsible.Panel.Props &
	AppearanceProps;

export function CollapsibleRoot({
	className,
	style,
	borderRadius,
	width,
	...props
}: CollapsibleRootProps) {
	return (
		<BaseCollapsible.Root
			{...props}
			className={mergeClassName(
				"w-full min-w-0 rounded-[var(--ui-radius-surface)] text-fg",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function CollapsibleTrigger({
	className,
	style,
	borderRadius,
	width,
	size = "md",
	variant = "ghost",
	...props
}: CollapsibleTriggerProps) {
	return (
		<BaseCollapsible.Trigger
			{...props}
			className={mergeClassName(
				controlStyles({
					size,
					variant,
					className:
						"cursor-pointer justify-between text-start font-semibold data-[panel-open]:text-primary [&>svg]:transition-transform data-[panel-open]:[&>svg]:rotate-180",
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function CollapsiblePanel({
	className,
	style,
	borderRadius,
	width,
	...props
}: CollapsiblePanelProps) {
	return (
		<BaseCollapsible.Panel
			{...props}
			className={mergeClassName(
				"h-[var(--collapsible-panel-height)] overflow-hidden text-fg-muted text-sm transition-[height,opacity] duration-200 data-[ending-style]:h-0 data-[starting-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export const Collapsible = {
	Root: CollapsibleRoot,
	Trigger: CollapsibleTrigger,
	Panel: CollapsiblePanel,
};
