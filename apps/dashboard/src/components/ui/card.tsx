"use client";

import { Frame, FramePanel } from "./primitives/frame";
import type { HTMLAttributes } from "react";
import { cn } from "#/shared/lib/classes";

import {
	CardHeader as PrimitiveHeader,
	CardFooter as PrimitiveFooter,
	Card as PrimitiveCard,
	CardPanel,
} from "./primitives/card";

import {
	type AppearanceProps,
	type EffectProps,
	appearanceStyle,
} from "./appearance";

export interface CardProps
	extends HTMLAttributes<HTMLDivElement>,
		AppearanceProps,
		EffectProps {
	variant?: "outlined" | "filled" | "elevated" | "ghost";
	title?: string;
	description?: string;
}
export type CardHeaderProps = HTMLAttributes<HTMLDivElement>;
export type CardContentProps = HTMLAttributes<HTMLDivElement>;
export type CardFooterProps = HTMLAttributes<HTMLDivElement>;
export function Card({
	borderRadius,
	width,
	style,
	effect: _effect,
	variant: _variant,
	title,
	description,
	children,
	...props
}: CardProps) {
	return (
		<PrimitiveCard
			{...props}
			style={appearanceStyle({ borderRadius, width }, style)}
		>
			{title || description ? (
				<PrimitiveHeader>
					{title ? <h3 className="font-semibold text-sm">{title}</h3> : null}
					{description ? (
						<p className="text-muted-foreground text-sm">{description}</p>
					) : null}
				</PrimitiveHeader>
			) : null}
			{children}
		</PrimitiveCard>
	);
}
export function ContentPanel({
	className,
	borderRadius,
	width,
	style,
	effect: _effect,
	variant: _variant,
	title,
	description,
	children,
	...props
}: CardProps) {
	return (
		<Frame className="min-w-0" style={appearanceStyle({ borderRadius, width })}>
			<FramePanel {...props} className={cn("flex-1", className)} style={style}>
				{title || description ? (
					<div className="mb-4 flex flex-col gap-1">
						{title ? <h3 className="font-semibold text-sm">{title}</h3> : null}
						{description ? (
							<p className="text-muted-foreground text-sm">{description}</p>
						) : null}
					</div>
				) : null}
				{children}
			</FramePanel>
		</Frame>
	);
}
export const CardHeader = PrimitiveHeader;
export const CardContent = CardPanel;
export const CardFooter = PrimitiveFooter;
