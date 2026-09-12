"use client";

import { OTPField as BaseOTPField } from "@base-ui/react/otp-field";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	controlStyles,
	mergeStyle,
} from "./appearance";

function Root({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseOTPField.Root.Props & AppearanceProps) {
	return (
		<BaseOTPField.Root
			{...props}
			className={mergeClassName("flex items-center gap-2", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Input({
	className,
	style,
	borderRadius,
	width,
	size,
	variant,
	...props
}: Omit<BaseOTPField.Input.Props, "size" | "width"> & ControlProps) {
	return (
		<BaseOTPField.Input
			{...props}
			className={mergeClassName(
				controlStyles({
					size,
					variant,
					className: "w-11 px-0 text-center font-medium tabular-nums",
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Separator({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseOTPField.Separator.Props & AppearanceProps) {
	return (
		<BaseOTPField.Separator
			{...props}
			className={mergeClassName("h-px w-2 bg-border", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
export const OTPField = { Root, Input, Separator };
