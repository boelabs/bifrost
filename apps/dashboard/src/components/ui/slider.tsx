"use client";

import { Slider as BaseSlider } from "@base-ui/react/slider";

import {
	type AppearanceProps,
	mergeClassName,
	labelStyles,
	mergeStyle,
	focusRing,
} from "./appearance";

function Root<Value extends number | readonly number[]>({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseSlider.Root.Props<Value> & AppearanceProps) {
	return (
		<BaseSlider.Root
			{...props}
			className={mergeClassName(
				"flex min-w-0 flex-col gap-2 data-[disabled]:opacity-50",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Control({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseSlider.Control.Props & AppearanceProps) {
	return (
		<BaseSlider.Control
			{...props}
			className={mergeClassName(
				"flex touch-none items-center select-none data-[orientation=horizontal]:h-6 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-48 data-[orientation=vertical]:w-6 data-[orientation=vertical]:flex-col",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Track({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseSlider.Track.Props & AppearanceProps) {
	return (
		<BaseSlider.Track
			{...props}
			className={mergeClassName(
				"relative grow rounded-full bg-secondary data-[orientation=horizontal]:h-1.5 data-[orientation=vertical]:w-1.5",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Indicator({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseSlider.Indicator.Props & AppearanceProps) {
	return (
		<BaseSlider.Indicator
			{...props}
			className={mergeClassName("rounded-full bg-primary", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Thumb({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseSlider.Thumb.Props & AppearanceProps) {
	return (
		<BaseSlider.Thumb
			{...props}
			className={mergeClassName(
				`${focusRing} has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-focus has-[input:focus-visible]:ring-offset-2 has-[input:focus-visible]:ring-offset-surface block size-5 rounded-full border-2 border-primary bg-surface shadow-sm`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Label({ className, ...props }: BaseSlider.Label.Props) {
	return (
		<BaseSlider.Label
			{...props}
			className={mergeClassName(labelStyles, className)}
		/>
	);
}
function Value({ className, ...props }: BaseSlider.Value.Props) {
	return (
		<BaseSlider.Value
			{...props}
			className={mergeClassName(
				"text-sm tabular-nums text-fg-muted",
				className,
			)}
		/>
	);
}
export const Slider = { Root, Control, Track, Indicator, Thumb, Label, Value };
