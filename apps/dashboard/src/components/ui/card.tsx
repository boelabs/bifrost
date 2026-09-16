"use client";

import { tv, type VariantProps } from "tailwind-variants";
import type { HTMLAttributes } from "react";

import {
	type AppearanceProps,
	type EffectProps,
	effectClassName,
	appearanceStyle,
} from "./appearance.ts";

const card = tv({
	slots: {
		root: "rounded-[var(--ui-radius-surface)] border bg-card text-card-foreground",
		header: "flex flex-col space-y-1.5 p-7",
		title: "font-semibold text-2xl leading-none tracking-tight",
		description: "text-fg-muted text-sm",
		content: "p-7 pt-0",
		footer: "flex items-center p-7 pt-0",
	},
	variants: {
		variant: {
			outlined: {
				root: "border border-border/50",
			},
			filled: {
				root: "border-surface-2 bg-surface-2",
			},
			elevated: { root: "border-border/40 shadow-sm" },
			ghost: { root: "border-transparent bg-transparent" },
		},
	},
	defaultVariants: {
		variant: "outlined",
	},
});

const styles = card();

type CardVariantProps = VariantProps<typeof card>;

interface CardProps
	extends HTMLAttributes<HTMLDivElement>,
		CardVariantProps,
		AppearanceProps,
		EffectProps {
	className?: string;
	title?: string;
	description?: string;
}

interface CardHeaderProps extends HTMLAttributes<HTMLDivElement> {
	className?: string;
}

interface CardContentProps extends HTMLAttributes<HTMLDivElement> {
	className?: string;
}

interface CardFooterProps extends HTMLAttributes<HTMLDivElement> {
	className?: string;
}

const Card = ({
	className,
	variant,
	effect = null,
	title,
	description,
	children,
	borderRadius,
	width,
	style,
	...props
}: CardProps) => (
	<div
		className={styles.root({
			variant,
			className: [effectClassName(effect), className],
		})}
		style={appearanceStyle({ borderRadius, width }, style)}
		{...props}
	>
		{(title || description) && (
			<div className={styles.header()}>
				{title && <h3 className={styles.title()}>{title}</h3>}
				{description && <p className={styles.description()}>{description}</p>}
			</div>
		)}
		{children}
	</div>
);

const CardHeader = ({ className, ...props }: CardHeaderProps) => (
	<div className={styles.header({ className })} {...props} />
);

const CardContent = ({ className, ...props }: CardContentProps) => (
	<div className={styles.content({ className })} {...props} />
);

const CardFooter = ({ className, ...props }: CardFooterProps) => (
	<div className={styles.footer({ className })} {...props} />
);

export { Card, CardHeader, CardContent, CardFooter };
export type { CardProps, CardHeaderProps, CardContentProps, CardFooterProps };
