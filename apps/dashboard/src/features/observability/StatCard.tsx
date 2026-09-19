"use client";

import type { StatusProps } from "#/components/ui/status";
import type { TablerIcon } from "@tabler/icons-react";
import { Status } from "#/components/ui/status";
import { Card } from "#/components/ui/card";

export interface StatNote {
	text: string;
	tone?: StatusProps["tone"];
	/** The unrounded figure, for a pointer that rests on the pill. */
	exact?: string;
}

/**
 * One headline number, at the size a number that leads a page should be read at.
 *
 * The shape is fixed — a label row, the figure, a caption — so the overview's tiles and the metrics
 * page's tiles are the same object twice rather than two arrangements of the same data.
 *
 * The pill sits under the figure rather than beside it, where a reference design would put it. Four
 * tiles across a 1440px window leave each one about 210px of usable width, and neither `$5495.70` at
 * 32px nor the label `Consumer cost` shares a line with a pill in that: laid out either way, two
 * tiles wrapped or truncated and two did not, which reads as a bug rather than as a layout. On its
 * own line every tile is the same shape at every width. Anything longer than a pill belongs in the
 * caption, where it can be a sentence.
 */
export function StatCard({
	label,
	value,
	exact,
	icon: Icon,
	note,
	detail,
}: {
	label: string;
	value: string;
	/** The unrounded figure, shown on hover where `value` is compact. */
	exact?: string;
	icon?: TablerIcon;
	note?: StatNote;
	detail: string;
}) {
	return (
		<Card className="flex min-w-0 flex-col p-7">
			<div className="flex min-w-0 items-center gap-2.5">
				{Icon ? (
					<Icon
						aria-hidden
						className="size-4.5 shrink-0 text-fg-muted"
						stroke={1.6}
					/>
				) : null}
				<h2 className="font-medium text-fg-muted text-sm">{label}</h2>
			</div>
			<p
				className="mt-6 font-semibold text-[2rem] tabular-nums leading-none tracking-tight"
				title={exact}
			>
				{value}
			</p>
			{note ? (
				<div className="mt-3.5">
					<Status title={note.exact} tone={note.tone ?? "neutral"}>
						{note.text}
					</Status>
				</div>
			) : null}
			<p className="mt-auto pt-5 text-fg-muted text-xs">{detail}</p>
		</Card>
	);
}
