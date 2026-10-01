"use client";

import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";
import { useId } from "react";

import {
	type AppearanceProps,
	type ControlProps,
	mergeClassName,
	mergeStyle,
} from "./appearance";

import {
	Checkbox as StyledCheckbox,
	type CheckboxPrimitive,
} from "./primitives/checkbox";

export function CheckboxGroup({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseCheckboxGroup.Props & AppearanceProps) {
	return (
		<BaseCheckboxGroup
			{...props}
			className={mergeClassName("flex flex-col gap-3", className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}

export interface CheckboxProps
	extends CheckboxPrimitive.Root.Props,
		ControlProps {}
export function Checkbox({
	children,
	size: _size,
	variant: _variant,
	borderRadius,
	width,
	style,
	...props
}: CheckboxProps) {
	const generatedId = useId();
	const id = props.id ?? generatedId;
	const control = (
		<StyledCheckbox
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
export { CheckboxPrimitive } from "./primitives/checkbox";
