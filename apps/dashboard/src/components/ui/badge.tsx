import { type AppearanceProps, appearanceStyle } from "./appearance.ts";
import { tv, type VariantProps } from "tailwind-variants";
import type { HTMLAttributes } from "react";

export const badge = tv({
	base: "inline-flex items-center justify-center gap-1 rounded-full font-semibold",
	variants: {
		variant: {
			attention: "bg-linear-to-r from-pink-500 to-purple-500 text-white",
			neutral: "bg-secondary text-secondary-fg",
			danger: "bg-danger text-danger-fg",
			success: "bg-success/15 text-success",
			warning: "bg-warning/20 text-warning",
			outlined: "border border-border text-fg-muted",
		},
		size: {
			sm: "px-2 py-0.5 text-xs",
			md: "px-3 py-1 text-xs",
			lg: "px-3 py-2 text-sm",
		},
	},
	defaultVariants: {
		variant: "attention",
		size: "md",
	},
});

type BadgeProps = VariantProps<typeof badge> &
	HTMLAttributes<HTMLSpanElement> &
	AppearanceProps;

const Badge = ({
	className,
	variant,
	size,
	borderRadius,
	width,
	style,
	...props
}: BadgeProps) => (
	<span
		className={badge({ variant, size, className })}
		style={appearanceStyle({ borderRadius, width }, style)}
		{...props}
	/>
);

export { Badge };
export type { BadgeProps };
