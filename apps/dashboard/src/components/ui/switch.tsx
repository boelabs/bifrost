"use client";

import { type ControlProps, mergeStyle } from "./appearance";
import { useId } from "react";

import {
	Switch as StyledSwitch,
	type SwitchPrimitive,
} from "./primitives/switch";

export interface SwitchProps extends SwitchPrimitive.Root.Props, ControlProps {}
export function Switch({
	children,
	size: _size,
	variant: _variant,
	borderRadius,
	width,
	style,
	...props
}: SwitchProps) {
	const generatedId = useId();
	const id = props.id ?? generatedId;
	const control = (
		<StyledSwitch
			{...props}
			id={id}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
	return children ? (
		<label
			className="inline-flex cursor-pointer items-center gap-2 text-foreground text-sm"
			htmlFor={id}
		>
			{control}
			{children}
		</label>
	) : (
		control
	);
}
export { SwitchPrimitive } from "./primitives/switch";
