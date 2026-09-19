"use client";

import { Accordion as BaseAccordion } from "@base-ui/react/accordion";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	controlStyles,
	mergeStyle,
} from "./appearance";

export type AccordionRootProps<Value = unknown> =
	BaseAccordion.Root.Props<Value> & AppearanceProps;
export type AccordionItemProps = BaseAccordion.Item.Props & AppearanceProps;
export type AccordionHeaderProps = BaseAccordion.Header.Props & AppearanceProps;
export type AccordionTriggerProps = BaseAccordion.Trigger.Props & ControlProps;
export type AccordionPanelProps = BaseAccordion.Panel.Props & AppearanceProps;

export function AccordionRoot<Value = unknown>({
	className,
	style,
	borderRadius,
	width,
	...props
}: AccordionRootProps<Value>) {
	return (
		<BaseAccordion.Root
			{...props}
			className={mergeClassName(
				"group/accordion flex w-full flex-col rounded-[var(--ui-radius-surface)] border border-border bg-surface data-[orientation=horizontal]:flex-row",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function AccordionItem({
	className,
	style,
	borderRadius,
	width,
	...props
}: AccordionItemProps) {
	return (
		<BaseAccordion.Item
			{...props}
			className={mergeClassName(
				"min-w-0 flex-1 border-border border-b last:border-b-0 data-[disabled]:opacity-50 group-data-[orientation=horizontal]/accordion:border-r group-data-[orientation=horizontal]/accordion:border-b-0 group-data-[orientation=horizontal]/accordion:last:border-r-0",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function AccordionHeader({
	className,
	style,
	borderRadius,
	width,
	...props
}: AccordionHeaderProps) {
	return (
		<BaseAccordion.Header
			{...props}
			className={mergeClassName("m-0 font-semibold text-sm", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function AccordionTrigger({
	className,
	style,
	borderRadius,
	width,
	size = "md",
	variant = "ghost",
	...props
}: AccordionTriggerProps) {
	return (
		<BaseAccordion.Trigger
			{...props}
			className={mergeClassName(
				controlStyles({
					size,
					variant,
					className:
						"w-full cursor-pointer justify-between text-start font-semibold data-[panel-open]:text-primary [&>svg]:shrink-0 [&>svg]:transition-transform data-[panel-open]:[&>svg]:rotate-180",
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function AccordionPanel({
	className,
	style,
	borderRadius,
	width,
	...props
}: AccordionPanelProps) {
	return (
		<BaseAccordion.Panel
			{...props}
			className={mergeClassName(
				"h-[var(--accordion-panel-height)] overflow-hidden text-fg-muted text-sm transition-[height,opacity] duration-200 data-[ending-style]:h-0 data-[starting-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export const Accordion = {
	Root: AccordionRoot,
	Item: AccordionItem,
	Header: AccordionHeader,
	Trigger: AccordionTrigger,
	Panel: AccordionPanel,
};
