"use client";

import { type AppearanceProps, appearanceStyle } from "./appearance.ts";
import { Alert, AlertDescription } from "./primitives/alert";
import type { CSSProperties, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { tv } from "tailwind-variants";
import { ContentPanel } from "./card";

import {
	EmptyDescription,
	EmptyContent,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
	Empty,
} from "./primitives/empty";

/** Page headings, empty states, and errors share the dashboard primitives. */
const page = tv({
	slots: {
		header: "flex flex-wrap items-start justify-between gap-4",
		identity: "flex min-w-0 flex-col gap-1",
		titleRow: "flex min-w-0 flex-wrap items-center gap-2",
		heading: "min-w-0 break-words font-semibold text-foreground text-xl",
		subtitle: "text-muted-foreground text-sm",
		toolbar: "flex shrink-0 flex-wrap items-center gap-2 empty:hidden",
	},
});

const { header, identity, titleRow, heading, subtitle, toolbar } = page();

/**
 * Every page starts here: its title, one line about it, a status badge for a record, and its
 * actions on the right (one primary button at most; the rest `outline`).
 */
export function PageHeader({
	title,
	description,
	badge,
	actions,
}: {
	title: ReactNode;
	description?: ReactNode;
	badge?: ReactNode;
	actions?: ReactNode;
}) {
	return (
		<header className={header()}>
			<div className={identity()}>
				<div className={titleRow()}>
					<h1 className={heading()}>{title}</h1>
					{badge}
				</div>
				{description ? <p className={subtitle()}>{description}</p> : null}
			</div>
			{actions ? <div className={toolbar()}>{actions}</div> : null}
		</header>
	);
}

/**
 * What a list or a block says when it has nothing to show, Billete's: an icon in a small tile, what
 * would be here and, optionally, the action that fills it.
 */
export function EmptyState({
	title,
	description,
	icon: Icon,
	children,
	framed = true,
	borderRadius,
	width,
	style,
}: {
	title: string;
	description?: string;
	icon?: LucideIcon;
	children?: ReactNode;
	framed?: boolean;
	style?: CSSProperties;
} & AppearanceProps) {
	const content = (
		<Empty className="md:py-14">
			<EmptyHeader>
				{Icon ? (
					<EmptyMedia variant="icon">
						<Icon aria-hidden="true" />
					</EmptyMedia>
				) : null}
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
