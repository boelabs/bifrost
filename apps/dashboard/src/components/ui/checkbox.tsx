"use client";

import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";
import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { IconCheck, IconMinus } from "@tabler/icons-react";
import { useId } from "react";

import {
	type AppearanceProps,
	type ControlProps,
	type UIVariant,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance";

const sizes = { xs: "size-3.5", sm: "size-4", md: "size-5", lg: "size-6" };
/** The unchecked surface. Checked and indeterminate states override it below. */
const surfaces: Record<UIVariant, string> = {
	filled: "border-transparent bg-surface-2",
	ghost: "border-transparent bg-transparent",
	outlined: "border-border bg-surface",
};
function Root({
	className,
	style,
	borderRadius,
	width,
	size = "md",
	variant = "outlined",
	...props
}: BaseCheckbox.Root.Props & ControlProps) {
	return (
		<BaseCheckbox.Root
			{...props}
			className={mergeClassName(
				`${focusRing} ${sizes[size]} inline-flex shrink-0 items-center justify-center rounded-[var(--ui-radius-item)] border ${surfaces[variant]} transition-colors data-[disabled]:cursor-not-allowed data-[checked]:border-primary data-[indeterminate]:border-primary data-[invalid]:border-danger data-[checked]:bg-primary data-[indeterminate]:bg-primary data-[checked]:text-primary-fg data-[indeterminate]:text-primary-fg data-[disabled]:opacity-50`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Indicator({ className, ...props }: BaseCheckbox.Indicator.Props) {
	return (
		<BaseCheckbox.Indicator
			{...props}
			className={mergeClassName("flex items-center justify-center", className)}
		/>
	);
}
export interface CheckboxProps extends BaseCheckbox.Root.Props, ControlProps {}
export function Checkbox({ children, ...props }: CheckboxProps) {
	const generatedId = useId();
	const id = props.id ?? generatedId;
	const control = (
		<Root {...props} id={id}>
			<Indicator>
				{props.indeterminate ? (
					<IconMinus className="size-3.5" />
				) : (
					<IconCheck className="size-3.5" />
				)}
			</Indicator>
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
export const CheckboxPrimitive = { Root, Indicator };
