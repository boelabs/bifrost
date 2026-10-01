"use client";

import { type AppearanceProps, appearanceStyle } from "./appearance.ts";
import { Alert, AlertDescription } from "./primitives/alert";
import type { CSSProperties, ReactNode } from "react";
import { tv } from "tailwind-variants";
import { ContentPanel } from "./card";

import {
	EmptyDescription,
	EmptyContent,
	EmptyHeader,
	EmptyTitle,
	Empty,
} from "./primitives/empty";

/** Page headings, empty states, and errors share the dashboard primitives. */
const page = tv({
	slots: {
		header: "flex flex-wrap items-start justify-between gap-4",
		heading: "font-semibold text-foreground text-xl",
		subtitle: "mt-1 text-muted-foreground text-sm",
		actions: "flex min-w-0 max-w-full flex-wrap items-center gap-2",
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
	framed = true,
	borderRadius,
	width,
	style,
}: {
	title: string;
	description?: string;
	children?: ReactNode;
	framed?: boolean;
	style?: CSSProperties;
} & AppearanceProps) {
	const content = (
		<Empty>
			<EmptyHeader>
				<EmptyTitle>{title}</EmptyTitle>
				{description ? (
					<EmptyDescription>{description}</EmptyDescription>
				) : null}
			</EmptyHeader>
			{children ? <EmptyContent>{children}</EmptyContent> : null}
		</Empty>
	);
	return framed ? (
		<ContentPanel
			className="p-0"
			style={appearanceStyle({ borderRadius, width }, style)}
		>
			{content}
		</ContentPanel>
	) : (
		content
	);
}

export function ErrorNote({
	children,
	borderRadius,
	width,
	style,
}: { children: ReactNode; style?: CSSProperties } & AppearanceProps) {
	return (
		<Alert
			style={appearanceStyle({ borderRadius, width }, style)}
			variant="error"
		>
			<AlertDescription>{children}</AlertDescription>
		</Alert>
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
