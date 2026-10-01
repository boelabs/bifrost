"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

export type TabsProps = BaseTabs.Root.Props & AppearanceProps;
export type TabListProps = BaseTabs.List.Props & AppearanceProps;
export type TabProps = BaseTabs.Tab.Props & ControlProps;
export type TabPanelProps = BaseTabs.Panel.Props & AppearanceProps;
export type TabIndicatorProps = BaseTabs.Indicator.Props & AppearanceProps;

export function TabsRoot({
	className,
	style,
	borderRadius,
	width,
	...props
}: TabsProps) {
	return (
		<BaseTabs.Root
			{...props}
			className={mergeClassName(
				"flex w-full min-w-0 flex-col gap-4 data-[orientation=vertical]:flex-row",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function TabList({
	className,
	style,
	borderRadius,
	width,
	...props
}: TabListProps) {
	return (
		<BaseTabs.List
			{...props}
			className={mergeClassName(
				"relative isolate flex w-fit max-w-full items-center gap-x-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground/72 data-[orientation=vertical]:flex-col",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function Tab({
	className,
	style,
	borderRadius,
	width,
	size: _size = "sm",
	variant: _variant = "ghost",
	...props
}: TabProps) {
	return (
		<BaseTabs.Tab
			{...props}
			className={mergeClassName(
				"relative flex h-9 shrink-0 grow cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-[calc(--spacing(2.5)-1px)] font-medium text-base outline-none transition-[color,background-color,box-shadow] not-data-active:hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring data-disabled:pointer-events-none data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start data-active:bg-background data-active:text-foreground data-disabled:opacity-64 data-active:shadow-sm/5 sm:h-8 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function TabPanel({
	className,
	style,
	borderRadius,
	width,
	...props
}: TabPanelProps) {
	return (
		<BaseTabs.Panel
			{...props}
			className={mergeClassName(
				`min-w-0 flex-1 rounded-(--ui-radius-surface) text-fg text-sm ${focusRing}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function TabIndicator({
	className,
	style,
	borderRadius,
	width,
	...props
}: TabIndicatorProps) {
	return (
		<BaseTabs.Indicator
			{...props}
			className={mergeClassName(
				"pointer-events-none absolute top-(--active-tab-top) left-(--active-tab-left) -z-10 h-(--active-tab-height) w-(--active-tab-width) rounded-md bg-background shadow-sm/5",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export const Tabs = {
	Root: TabsRoot,
	List: TabList,
	Tab,
	Panel: TabPanel,
	Indicator: TabIndicator,
};
