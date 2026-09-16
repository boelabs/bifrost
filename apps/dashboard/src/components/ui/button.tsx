"use client";

import { Button as BaseButton } from "@base-ui/react/button";
import { tv, type VariantProps } from "tailwind-variants";
import { IconLoader2 } from "@tabler/icons-react";

import {
	type AppearanceProps,
	type EffectProps,
	effectClassName,
	mergeClassName,
	mergeStyle,
	focusRing,
} from "./appearance.ts";

export const buttonStyles = tv({
	base: `inline-flex shrink-0 appearance-none items-center justify-center gap-2 rounded-full border border-transparent font-semibold transition-none disabled:pointer-events-none disabled:opacity-50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ${focusRing}`,
	variants: {
		variant: {
			primary: "bg-primary text-primary-fg hover:bg-primary-hover",
			/**
			 * Flat, not outlined. It is the companion to `primary` in the same row, and an outline
			 * beside a solid pill reads as two different kinds of control rather than two weights of
			 * the same one.
			 *
			 * On `--field`, the same ground the inputs stand on — not on `--secondary`. The search
			 * button sits against its own search box, and two greys a point and a half apart read as
			 * a mistake rather than as a distinction.
			 */
			secondary: "bg-field text-fg hover:bg-field-hover",
			ghost:
				"bg-transparent text-fg hover:bg-secondary hover:text-secondary-fg",
			danger: "bg-danger text-danger-fg hover:bg-danger/80",
			link: "bg-transparent text-fg underline-offset-4 hover:underline",
		},
		size: {
			xs: "min-h-8 px-2.5 py-1 text-xs",
			sm: "min-h-10 px-4 py-2 text-sm",
			md: "min-h-12 px-5 py-3 text-base",
			lg: "min-h-14 px-7 py-3.5 text-lg font-bold",
		},
		/**
		 * Geometry, kept apart from scale: a button holding one icon has no text to give it width, so
		 * the horizontal padding meant for a label leaves a wide pill around a 15px glyph. `icon` drops
		 * that padding and squares the control, so it lines up with its neighbours in a table row
		 * instead of sprawling across the column.
		 */
		mode: {
			default: "",
			// `min-h-0` because the size variant's `min-h-*` would otherwise outlive an overridden
			// `size-*`: a caller asking for `lg:size-8` got a 32px-wide box held 36px tall, which is
			// how the playground's message actions stopped lining up with each other.
			icon: "aspect-square shrink-0 p-0 min-h-0",
		},
	},
	compoundVariants: [
		// `min-h` alone leaves the width to the content, which `aspect-square` cannot correct. Pinning
		// both dimensions per size is what actually makes the square, at the same heights as the
		// equivalent labelled button.
		{ mode: "icon", size: "xs", class: "size-8" },
		{ mode: "icon", size: "sm", class: "size-10" },
		{ mode: "icon", size: "md", class: "size-12" },
		{ mode: "icon", size: "lg", class: "size-14" },
	],
	defaultVariants: { variant: "primary", size: "md", mode: "default" },
});

export interface ButtonProps
	extends BaseButton.Props,
		AppearanceProps,
		EffectProps,
		VariantProps<typeof buttonStyles> {
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
	effect = null,
	loading = false,
	disabled,
	children,
	...props
}: ButtonProps) {
	return (
		<BaseButton
			{...props}
			disabled={disabled || loading}
			aria-busy={loading || undefined}
			className={mergeClassName(
				`${buttonStyles({ size, variant, mode })} ${effectClassName(effect)}`,
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		>
			{loading && <IconLoader2 aria-hidden className="size-4 animate-spin" />}
			{children}
		</BaseButton>
	);
}
