"use client";

import { Tabs as BaseTabs } from "@base-ui/react/tabs";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	controlStyles,
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
				"relative isolate flex w-fit max-w-full shrink-0 gap-1 rounded-(--ui-radius-control) bg-surface-2 p-1 data-[orientation=vertical]:flex-col",
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
	size = "sm",
	variant = "ghost",
	...props
}: TabProps) {
	return (
		<BaseTabs.Tab
			{...props}
			className={mergeClassName(
				controlStyles({
					size,
					variant,
					className:
						"relative z-10 cursor-pointer justify-center whitespace-nowrap font-semibold text-fg-muted data-[active]:bg-surface data-[active]:text-primary data-[active]:shadow-sm",
				}),
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
				"pointer-events-none absolute top-(--active-tab-top) left-(--active-tab-left) z-20 h-(--active-tab-height) w-(--active-tab-width) rounded-(--ui-radius-control) ring-1 ring-primary/30 transition-[top,left,width,height] duration-200",
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
