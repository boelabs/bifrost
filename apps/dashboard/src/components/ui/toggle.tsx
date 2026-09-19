"use client";

import { Toggle as BaseToggle } from "@base-ui/react/toggle";

import {
	type ControlProps,
	mergeClassName,
	controlStyles,
	mergeStyle,
} from "./appearance";

export type ToggleProps = BaseToggle.Props & ControlProps;

export function Toggle({
	className,
	style,
	borderRadius,
	width,
	size = "md",
	variant = "outlined",
	...props
}: ToggleProps) {
	return (
		<BaseToggle
			{...props}
			className={mergeClassName(
				controlStyles({
					size,
					variant,
					className:
						"inline-flex cursor-pointer justify-center rounded-(--ui-toggle-radius,var(--ui-radius-control)) font-medium data-pressed:border-primary/40 data-pressed:bg-primary/10 data-pressed:text-primary",
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
