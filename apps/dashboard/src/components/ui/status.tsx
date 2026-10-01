"use client";

import { type AppearanceProps, appearanceStyle } from "./appearance.ts";
import { badgeVariants } from "./primitives/badge";
import type { HTMLAttributes } from "react";

const tones = {
	neutral: "secondary",
	success: "success",
	warning: "warning",
	danger: "error",
	muted: "outline",
} as const;
type StatusProps = HTMLAttributes<HTMLSpanElement> &
	AppearanceProps & { tone?: keyof typeof tones };
const Status = ({
	className,
	tone,
	borderRadius,
	width,
	style,
	...props
}: StatusProps) => (
	<span
		className={badgeVariants({ variant: tones[tone ?? "neutral"], className })}
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
