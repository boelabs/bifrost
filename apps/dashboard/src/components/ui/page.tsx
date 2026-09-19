"use client";

import { type AppearanceProps, appearanceStyle } from "./appearance.ts";
import type { CSSProperties, ReactNode } from "react";
import { tv } from "tailwind-variants";

/**
 * Page furniture shared by every feature: header, empty state, and inline error. Written in
 * BaseLayer's idiom (tv slots, its tokens) so the chrome and the components look like one system.
 */
const page = tv({
	slots: {
		header: "flex flex-wrap items-start justify-between gap-4 pb-7",
		heading:
			"font-semibold text-[1.75rem] text-fg leading-tight tracking-tight",
		subtitle: "mt-1.5 max-w-2xl text-fg-muted text-sm",
		actions: "flex items-center gap-2",
	},
});

const { header, heading, subtitle, actions } = page();

export function PageHeader({
	title,
	description,
	children,
}: {
	title: string;
	description?: string;
	children?: ReactNode;
}) {
	return (
		<div className={header()}>
			<div>
				<h1 className={heading()}>{title}</h1>
				{description ? <p className={subtitle()}>{description}</p> : null}
			</div>
			{children ? <div className={actions()}>{children}</div> : null}
		</div>
	);
}

export function EmptyState({
	title,
	description,
	children,
	borderRadius,
	width,
	style,
}: {
	title: string;
	description?: string;
	children?: ReactNode;
	style?: CSSProperties;
} & AppearanceProps) {
	return (
		<div
			className="flex flex-col items-center justify-center gap-2 rounded-(--ui-radius-surface) border border-border/50 border-dashed px-6 py-16 text-center"
			style={appearanceStyle({ borderRadius, width }, style)}
		>
			<p className="font-medium text-fg">{title}</p>
			{description ? (
				<p className="max-w-md text-fg-muted text-sm">{description}</p>
			) : null}
			{children ? <div className="mt-4">{children}</div> : null}
		</div>
	);
}

export function ErrorNote({
	children,
	borderRadius,
	width,
	style,
}: { children: ReactNode; style?: CSSProperties } & AppearanceProps) {
	return (
		<p
			className="rounded-(--ui-radius-control) border border-danger/30 bg-danger/10 px-3 py-2 font-medium text-danger text-sm"
			role="alert"
			style={appearanceStyle({ borderRadius, width }, style)}
		>
			{children}
		</p>
	);
}

/** Neutral placeholder while a route loader resolves. */
export function Loading({ label = "Loading…" }: { label?: string }) {
	return (
		<div className="flex items-center justify-center py-16 text-fg-muted text-sm">
			{label}
		</div>
	);
}
