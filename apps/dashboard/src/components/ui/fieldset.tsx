"use client";

import { Fieldset as BaseFieldset } from "@base-ui/react/fieldset";

import {
	type AppearanceProps,
	mergeClassName,
	labelStyles,
	mergeStyle,
} from "./appearance";

function Root({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseFieldset.Root.Props & AppearanceProps) {
	return (
		<BaseFieldset.Root
			{...props}
			className={mergeClassName(
				"flex min-w-0 flex-col gap-4 rounded-[var(--ui-radius-surface)] border border-border/60 p-4",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
function Legend({
	className,
	style,
	borderRadius,
	width,
	...props
}: BaseFieldset.Legend.Props & AppearanceProps) {
	return (
		<BaseFieldset.Legend
			{...props}
			className={mergeClassName(`${labelStyles} px-1`, className)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
export const Fieldset = { Root, Legend };
