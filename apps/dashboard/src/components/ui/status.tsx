"use client";

import { type AppearanceProps, appearanceStyle } from "./appearance.ts";
import { tv, type VariantProps } from "tailwind-variants";
import type { HTMLAttributes } from "react";

/**
 * Outcome pill for logs and health. BaseLayer's own Badge only ships attention/neutral/danger, and
 * operation outcomes need success and warning too — so this extends the same shape (rounded-4xl,
 * semibold, text-xs) with the success/warning tokens declared in styles.css, rather than inventing a
 * second badge language.
 */
const status = tv({
	base: "inline-flex items-center justify-center gap-1.5 rounded-4xl px-3 py-1.5 font-semibold text-xs",
	variants: {
		tone: {
			neutral: "bg-secondary text-secondary-fg",
			success: "bg-success/15 text-success",
			warning: "bg-warning/20 text-warning",
			danger: "bg-danger/15 text-danger",
			muted: "border border-border text-fg-muted",
		},
	},
	defaultVariants: { tone: "neutral" },
});

type StatusProps = VariantProps<typeof status> &
	HTMLAttributes<HTMLSpanElement> &
	AppearanceProps;

const Status = ({
	className,
	tone,
	borderRadius,
	width,
	style,
	...props
}: StatusProps) => (
	<span
		className={status({ tone, className })}
		style={appearanceStyle({ borderRadius, width }, style)}
		{...props}
	/>
);

/** Maps a gateway operation outcome to a tone, so every view colours them identically. */
export function outcomeTone(
	outcome: string | null | undefined,
): NonNullable<StatusProps["tone"]> {
	switch (outcome) {
		case "success":
			return "success";
		case "incomplete":
		case "cancelled":
			return "warning";
		case "error":
		case "blocked":
		case "abandoned":
			return "danger";
		default:
			return "muted";
	}
}

Status.displayName = "Status";

export { Status };
export type { StatusProps };
