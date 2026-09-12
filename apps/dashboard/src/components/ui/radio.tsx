"use client";

import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import { Radio as BaseRadio } from "@base-ui/react/radio";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

const sizes = { xs: "size-3.5", sm: "size-4", md: "size-5", lg: "size-6" };
function Root({
	className,
	style,
	borderRadius,
	width,
	size = "md",
	variant = "outlined",
	...props
}: BaseRadio.Root.Props & ControlProps) {
	return (
		<BaseRadio.Root
			{...props}
			className={mergeClassName(
				`${focusRing} ${sizes[size]} inline-flex shrink-0 items-center justify-center rounded-full border ${variant === "filled" ? "border-transparent bg-surface-2" : variant === "ghost" ? "border-transparent bg-transparent" : "border-border bg-surface"} data-[checked]:border-primary data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50`,
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
}: BaseRadio.Indicator.Props & AppearanceProps) {
	return (
		<BaseRadio.Indicator
			{...props}
			className={mergeClassName("size-1/2 rounded-full bg-primary", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
export function RadioGroup({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseRadioGroup.Props & AppearanceProps) {
	return (
		<BaseRadioGroup
			{...props}
			className={mergeClassName("flex flex-col gap-3", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
export const Radio = { Root, Indicator };
