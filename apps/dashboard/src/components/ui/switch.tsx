"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { useId } from "react";

import {
	type AppearanceProps,
	type ControlProps,
	type UIVariant,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

const sizes = { xs: "h-4 w-7", sm: "h-5 w-9", md: "h-6 w-11", lg: "h-7 w-13" };
/** The track behind the thumb, while the switch is off. */
const tracks: Record<UIVariant, string> = {
	outlined: "border-border bg-surface",
	ghost: "border-transparent bg-secondary/60",
	filled: "border-transparent bg-secondary",
};
function Root({
	className,
	style,
	borderRadius,
	width,
	size = "md",
	variant = "filled",
	...props
}: BaseSwitch.Root.Props & ControlProps) {
	return (
		<BaseSwitch.Root
			{...props}
			className={mergeClassName(
				`${focusRing} ${sizes[size]} relative inline-flex shrink-0 items-center rounded-full border p-0.5 ${tracks[variant]} transition-colors data-[disabled]:cursor-not-allowed data-[checked]:border-primary data-[checked]:bg-primary data-[disabled]:opacity-50`,
				className,
			)}
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
}: BaseSwitch.Thumb.Props & AppearanceProps) {
	return (
		<BaseSwitch.Thumb
			{...props}
			className={mergeClassName(
				"block aspect-square h-full rounded-full bg-fg-muted shadow-sm transition-[margin,background-color] data-[checked]:ml-auto data-[checked]:bg-primary-fg",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
export interface SwitchProps extends BaseSwitch.Root.Props, ControlProps {}
export function Switch({ children, ...props }: SwitchProps) {
	const generatedId = useId();
	const id = props.id ?? generatedId;
	const control = (
		<Root {...props} id={id}>
			<Thumb />
		</Root>
	);
	return children ? (
		<label
			className="inline-flex cursor-pointer items-center gap-2 text-fg text-sm"
			htmlFor={id}
		>
			{control}
			{children}
		</label>
	) : (
		control
	);
}
export const SwitchPrimitive = { Root, Thumb };
