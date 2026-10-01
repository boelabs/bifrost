"use client";

import { type AppearanceProps, mergeClassName, mergeStyle } from "./appearance";
import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import type { CSSProperties, RefAttributes } from "react";

export type ToggleGroupProps<Value extends string = string> =
	BaseToggleGroup.Props<Value> &
		AppearanceProps &
		RefAttributes<HTMLDivElement>;

function groupStyle(style: CSSProperties): CSSProperties {
	const radius = style.borderRadius ?? "var(--ui-radius-control)";
	return {
		"--ui-toggle-radius": `max(0px, calc(${typeof radius === "number" ? `${radius}px` : radius} - 0.125rem))`,
		...style,
	} as CSSProperties;
}

export function ToggleGroup<Value extends string = string>({
	className,
	style,
	borderRadius,
	width,
	...props
}: ToggleGroupProps<Value>) {
	const mergedStyle = mergeStyle({ borderRadius, width }, style);
	return (
		<BaseToggleGroup
			{...props}
			className={mergeClassName(
				"inline-flex w-fit gap-0.5 rounded-lg bg-muted p-0.5 data-[orientation=vertical]:flex-col",
				className,
			)}
			style={
				typeof mergedStyle === "function"
					? (state) => groupStyle(mergedStyle(state))
					: groupStyle(mergedStyle)
			}
		/>
	);
}
