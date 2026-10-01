"use client";

import { type ControlProps, mergeClassName, mergeStyle } from "./appearance";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { toggleVariants } from "./primitives/toggle";

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
				toggleVariants({
					size: ({ md: "default", xs: "sm", sm: "sm", lg: "lg" } as const)[
						size
					],
					variant: variant === "outlined" ? "outline" : "default",
					className: "rounded-(--ui-toggle-radius,var(--radius-lg))",
				}),
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
