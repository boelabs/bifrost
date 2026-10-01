import { type AppearanceProps, appearanceStyle } from "./appearance";
import { badgeVariants } from "./primitives/badge";
import type { HTMLAttributes } from "react";

const variants = {
	attention: "info",
	neutral: "secondary",
	danger: "error",
	success: "success",
	warning: "warning",
	outlined: "outline",
} as const;
const sizes = { sm: "sm", md: "default", lg: "lg" } as const;
export interface BadgeProps
	extends HTMLAttributes<HTMLSpanElement>,
		AppearanceProps {
	variant?: keyof typeof variants;
	size?: keyof typeof sizes;
}
export function badge({
	variant = "neutral",
	size = "md",
	className,
}: Pick<BadgeProps, "variant" | "size" | "className"> = {}) {
	return badgeVariants({
		variant: variants[variant],
		size: sizes[size],
		className,
	});
}
export function Badge({
	className,
	variant,
	size,
	borderRadius,
	width,
	style,
	...props
}: BadgeProps) {
	return (
		<span
			{...props}
			className={badge({ variant, size, className })}
			data-slot="badge"
			style={appearanceStyle({ borderRadius, width }, style)}
		/>
	);
}
