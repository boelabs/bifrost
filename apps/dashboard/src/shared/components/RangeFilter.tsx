"use client";

import { PopoverRoot, PopoverTrigger, Popover } from "#/components/ui/popover";
import type { Query } from "#/shared/lib/useSearchWriter.ts";
import { Select, SelectItem } from "#/components/ui/select";
import { IconCalendar } from "@tabler/icons-react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { useState } from "react";

import {
	customRangeIsValid,
	type RangeSearch,
	MAX_RANGE_DAYS,
	type RangeKey,
	RANGES,
} from "#/shared/lib/range.ts";

const day = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	timeZone: "UTC",
});

function dayLabel(iso: string): string {
	const parsed = Date.parse(`${iso}T00:00:00Z`);
	return Number.isFinite(parsed) ? day.format(parsed) : iso;
}

/**
 * The time range control, shared by every table that has one.
 *
 * Custom dates live in a popover rather than in the toolbar itself. Two labelled date fields, a
 * button and a hint are four controls of three different heights, and inline they push everything
 * beside them onto a second row — the toolbar stops being a row of filters and becomes a form. In a
 * popover the toolbar keeps one control of one height whatever the period is, and the trigger says
 * which dates are in force without opening anything.
 *
 * The period applies the moment it changes; the dates apply on submit, because a half-typed date is
 * not a range anybody asked for and re-running the page on each keystroke would fight the person
 * filling the second field. Neither is held here — the URL is what remembers, so a range survives a
 * reload and can be handed to someone else as a link.
 */
export function RangeFilter({
	periods,
	value,
	fallback,
	onChange,
	label,
}: {
	periods: readonly RangeKey[];
	value: RangeSearch;
	/** The period in force when the URL carries none. */
	fallback: RangeKey;
	/**
	 * Typed as the writer's patch shape, not as `RangeSearch`: what comes back is on its way
	 * into the query string, and `Query` is the only shape `useSearchWriter` accepts.
	 */
	onChange: (patch: Query) => void;
	/** Set on pages that label their controls; toolbars label by `aria-label` instead. */
	label?: string;
}) {
	const period = value.period ?? fallback;
	const today = new Date().toISOString().slice(0, 10);
	const [open, setOpen] = useState(false);
	const [from, setFrom] = useState(value.from ?? today);
	const [to, setTo] = useState(value.to ?? today);
	const valid = customRangeIsValid(from, to);
	const applied =
		value.from && value.to
			? `${dayLabel(value.from)} – ${dayLabel(value.to)}`
			: "Pick dates";

	return (
		<>
			<Select
				aria-label={label ? undefined : "Time range"}
				{...(label ? { label } : {})}
				onValueChange={(key) => {
					if (!key) {
						return;
					}
					const next = key as RangeKey;
					if (next === "custom") {
						// Opening the picker is the point of choosing "Custom dates"; applying whatever
						// was last in the fields would answer a question nobody asked yet.
						setOpen(true);
						onChange({ period: next, from, to });
						return;
					}
					onChange({ period: next, from: undefined, to: undefined });
				}}
				size="sm"
				value={period}
			>
				{periods.map((key) => (
					<SelectItem key={key} value={key}>
						{RANGES[key]}
					</SelectItem>
				))}
			</Select>
			{period === "custom" ? (
				<PopoverRoot onOpenChange={setOpen} open={open}>
					<PopoverTrigger
						aria-label="Choose custom dates"
						render={<Button size="sm" variant="secondary" />}
					>
						<IconCalendar aria-hidden size={15} />
						{applied}
					</PopoverTrigger>
					<Popover aria-label="Custom date range" className="w-72 p-4">
						<form
							className="flex flex-col gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								if (!valid) {
									return;
								}
								onChange({ period: "custom", from, to });
								setOpen(false);
							}}
						>
							<Input
								label="From (UTC)"
								max={today}
								onChange={(event) => setFrom(event.target.value)}
								required
								size="sm"
								type="date"
								value={from}
							/>
							<Input
								label="Through (UTC)"
								max={today}
								onChange={(event) => setTo(event.target.value)}
								required
								size="sm"
								type="date"
								value={to}
							/>
							<p className="text-fg-muted text-xs">
								Up to {MAX_RANGE_DAYS} days. The end date is included.
							</p>
							<Button disabled={!valid} size="sm" type="submit">
								Apply dates
							</Button>
						</form>
					</Popover>
				</PopoverRoot>
			) : null}
		</>
	);
}
