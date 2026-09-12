"use client";

import { type AppearanceProps, mergeClassName, mergeStyle } from "./appearance";
import { Separator as BaseSeparator } from "@base-ui/react/separator";

export type SeparatorProps = BaseSeparator.Props & AppearanceProps;

export function Separator({
	className,
	style,
	borderRadius,
	width,
	...props
}: SeparatorProps) {
	return (
		<BaseSeparator
			{...props}
			className={mergeClassName(
				"shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:min-h-4 data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
				className,
			)}
			style={mergeStyle({ borderRadius, width }, style)}
		/>
	);
}
