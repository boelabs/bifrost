"use client";

import { type AppearanceProps, mergeClassName, mergeStyle } from "./appearance";
import { Meter as BaseMeter } from "@base-ui/react/meter";

export type MeterRootProps = BaseMeter.Root.Props & AppearanceProps;
export type MeterTrackProps = BaseMeter.Track.Props & AppearanceProps;
export type MeterIndicatorProps = BaseMeter.Indicator.Props & AppearanceProps;
export type MeterLabelProps = BaseMeter.Label.Props & AppearanceProps;
export type MeterValueProps = BaseMeter.Value.Props & AppearanceProps;

export function MeterRoot({
	className,
	style,
	borderRadius,
	width,
	...props
}: MeterRootProps) {
	return (
		<BaseMeter.Root
			{...props}
			className={mergeClassName(
				"grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 text-sm",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function MeterTrack({
	className,
	style,
	borderRadius,
	width,
	...props
}: MeterTrackProps) {
	return (
		<BaseMeter.Track
			{...props}
			className={mergeClassName(
				"relative col-span-2 h-2 overflow-hidden rounded-full bg-secondary",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function MeterIndicator({
	className,
	style,
	borderRadius,
	width,
	...props
}: MeterIndicatorProps) {
	return (
		<BaseMeter.Indicator
			{...props}
			className={mergeClassName(
				"h-full rounded-[inherit] bg-primary transition-[width] duration-300",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function MeterLabel({
	className,
	style,
	borderRadius,
	width,
	...props
}: MeterLabelProps) {
	return (
		<BaseMeter.Label
			{...props}
			className={mergeClassName("font-medium text-fg", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function MeterValue({
	className,
	style,
	borderRadius,
	width,
	...props
}: MeterValueProps) {
	return (
		<BaseMeter.Value
			{...props}
			className={mergeClassName(
				"justify-self-end text-fg-muted tabular-nums",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export const Meter = {
	Root: MeterRoot,
	Track: MeterTrack,
	Indicator: MeterIndicator,
	Label: MeterLabel,
	Value: MeterValue,
};
