"use client";

import { NumberField as BaseNumberField } from "@base-ui/react/number-field";
import { numberFieldGroupVariants } from "./primitives/number-field";
import { Minus as IconMinus, Plus as IconPlus } from "lucide-react";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

function Root({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseNumberField.Root.Props & AppearanceProps) {
	return (
		<BaseNumberField.Root
			{...props}
			className={mergeClassName("flex min-w-0 flex-col gap-2", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Group({
	className,
	style,
	borderRadius,
	width,
	size,
	variant,
	...props
}: BaseNumberField.Group.Props & ControlProps) {
	return (
		<BaseNumberField.Group
			{...props}
			className={mergeClassName(
				numberFieldGroupVariants({
					className:
						"gap-0 overflow-hidden p-0" +
						{
							xs: "min-h-7 sm:min-h-6",
							sm: "min-h-8 sm:min-h-7",
							md: "min-h-9 sm:min-h-8",
							lg: "min-h-10 sm:min-h-9",
						}[size ?? "md"] +
						(variant === "ghost"
							? "border-transparent bg-transparent shadow-none"
							: ""),
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Input({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseNumberField.Input.Props & AppearanceProps) {
	return (
		<BaseNumberField.Input
			{...props}
			className={mergeClassName(
				"h-8.5 w-full min-w-0 flex-1 bg-transparent px-2 text-center tabular-nums outline-none disabled:cursor-not-allowed sm:h-7.5",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
const stepper = `${focusRing} flex self-stretch items-center justify-center px-3 hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50`;
function Increment({
	className,
	style,
	borderRadius,
	width,
	children,
	...props
}: BaseNumberField.Increment.Props & AppearanceProps) {
	return (
		<BaseNumberField.Increment
			{...props}
			className={mergeClassName(stepper, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children ?? <IconPlus className="size-4" />}
		</BaseNumberField.Increment>
	);
}
function Decrement({
	className,
	style,
	borderRadius,
	width,
	children,
	...props
}: BaseNumberField.Decrement.Props & AppearanceProps) {
	return (
		<BaseNumberField.Decrement
			{...props}
			className={mergeClassName(stepper, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children ?? <IconMinus className="size-4" />}
		</BaseNumberField.Decrement>
	);
}
function ScrubArea({ className, ...props }: BaseNumberField.ScrubArea.Props) {
	return (
		<BaseNumberField.ScrubArea
			{...props}
			className={mergeClassName("cursor-ew-resize select-none", className)}
		/>
	);
}
export const NumberField = {
	...BaseNumberField,
	Root,
	Group,
	Input,
	Increment,
	Decrement,
	ScrubArea,
};
