"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import { buttonVariants } from "./primitives/button";
import { Spinner } from "./primitives/spinner";

import {
	type AppearanceProps,
	type EffectProps,
	mergeClassName,
	type UISize,
	mergeStyle,
} from "./appearance";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";
type ButtonMode = "default" | "icon";
const sizes = { xs: "xs", sm: "sm", md: "default", lg: "lg" } as const;
const iconSizes = {
	xs: "icon-xs",
	sm: "icon-sm",
	md: "icon",
	lg: "icon-lg",
} as const;
const variants = {
	primary: "default",
	secondary: "outline",
	ghost: "ghost",
	danger: "destructive",
	link: "link",
} as const;
function resolveButtonStyles({
	size = "md",
	variant = "primary",
	mode = "default",
}: {
	size?: UISize | null;
	variant?: ButtonVariant | null;
	mode?: ButtonMode | null;
} = {}) {
	return (
		buttonVariants({
			size: mode === "icon" ? iconSizes[size ?? "md"] : sizes[size ?? "md"],
			variant: variants[variant ?? "primary"],
		}) + (mode === "icon" ? " p-0" : "")
	);
}
export const buttonStyles = Object.assign(resolveButtonStyles, {
	variants: { size: sizes, variant: variants },
});
export interface ButtonProps
	extends BaseButton.Props,
		AppearanceProps,
		EffectProps {
	size?: UISize;
	variant?: ButtonVariant;
	mode?: ButtonMode;
	loading?: boolean;
}
export function Button({
	className,
	style,
	borderRadius,
	width,
	size,
	variant,
	mode,
	effect: _effect,
	loading = false,
	disabled,
	children,
	...props
}: ButtonProps) {
	return (
		<BaseButton
			{...props}
			aria-busy={loading || undefined}
			className={mergeClassName(
				buttonStyles({ size, variant, mode }),
				className,
			)}
			data-loading={loading ? "" : undefined}
			data-slot="button"
			disabled={disabled || loading}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{children}
			{loading ? (
				<Spinner
					className="pointer-events-none absolute"
					data-slot="button-loading-indicator"
				/>
			) : null}
		</BaseButton>
	);
}
