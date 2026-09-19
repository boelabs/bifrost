"use client";

import { type AppearanceProps, mergeClassName, mergeStyle } from "./appearance";
import { Progress as BaseProgress } from "@base-ui/react/progress";

export type ProgressRootProps = BaseProgress.Root.Props & AppearanceProps;
export type ProgressTrackProps = BaseProgress.Track.Props & AppearanceProps;
export type ProgressIndicatorProps = BaseProgress.Indicator.Props &
	AppearanceProps;
export type ProgressLabelProps = BaseProgress.Label.Props & AppearanceProps;
export type ProgressValueProps = BaseProgress.Value.Props & AppearanceProps;
export type ProgressStatus = BaseProgress.Status;

export function ProgressRoot({
	className,
	style,
	borderRadius,
	width,
	...props
}: ProgressRootProps) {
	return (
		<BaseProgress.Root
			{...props}
			className={mergeClassName(
				"grid w-full grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 text-sm",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ProgressTrack({
	className,
	style,
	borderRadius,
	width,
	...props
}: ProgressTrackProps) {
	return (
		<BaseProgress.Track
			{...props}
			className={mergeClassName(
				"relative col-span-2 h-2 overflow-hidden rounded-full bg-secondary",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ProgressIndicator({
	className,
	style,
	borderRadius,
	width,
	...props
}: ProgressIndicatorProps) {
	return (
		<BaseProgress.Indicator
			{...props}
			className={mergeClassName(
				"h-full rounded-[inherit] bg-primary transition-[width] duration-300 data-indeterminate:w-full data-indeterminate:animate-pulse motion-reduce:animate-none",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ProgressLabel({
	className,
	style,
	borderRadius,
	width,
	...props
}: ProgressLabelProps) {
	return (
		<BaseProgress.Label
			{...props}
			className={mergeClassName("font-medium text-fg", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export function ProgressValue({
	className,
	style,
	borderRadius,
	width,
	...props
}: ProgressValueProps) {
	return (
		<BaseProgress.Value
			{...props}
			className={mergeClassName(
				"justify-self-end text-fg-muted tabular-nums",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export const Progress = {
	Root: ProgressRoot,
	Track: ProgressTrack,
	Indicator: ProgressIndicator,
	Label: ProgressLabel,
	Value: ProgressValue,
};
