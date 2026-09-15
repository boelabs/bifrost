"use client";

import { Select, SelectItem } from "#/components/ui/select";
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

/**
 * The time range control, shared by every table that has one.
 *
 * The period is applied the moment it changes, but custom dates are applied on submit: a half-typed
 * date is not a range anybody asked for, and re-running the page on each keystroke would fight the
 * person filling the second field. The control never holds the applied range itself — that lives in
 * the URL, so a range survives a reload and can be handed to someone else as a link.
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
	onChange: (patch: RangeSearch) => void;
	/** Set on pages that label their controls; toolbars label by `aria-label` instead. */
	label?: string;
}) {
	const period = value.period ?? fallback;
	const today = new Date().toISOString().slice(0, 10);
	const [from, setFrom] = useState(value.from ?? today);
	const [to, setTo] = useState(value.to ?? today);
	const valid = customRangeIsValid(from, to);

	return (
		<>
			<Select
				aria-label={label ? undefined : "Time range"}
				{...(label ? { label } : {})}
				size="sm"
				value={period}
				onValueChange={(key) => {
					if (!key) return;
					const next = key as RangeKey;
					onChange({
						period: next,
						...(next === "custom"
							? { from, to }
							: { from: undefined, to: undefined }),
					});
				}}
			>
				{periods.map((key) => (
					<SelectItem key={key} value={key}>
						{RANGES[key]}
					</SelectItem>
				))}
			</Select>
			{period === "custom" ? (
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (valid) onChange({ period: "custom", from, to });
					}}
				>
					<Input
						label="From (UTC)"
						type="date"
						size="sm"
						value={from}
						max={today}
						onChange={(event) => setFrom(event.target.value)}
						required
					/>
					<Input
						label="Through (UTC)"
						type="date"
						size="sm"
						value={to}
						max={today}
						onChange={(event) => setTo(event.target.value)}
						required
					/>
					<Button type="submit" variant="secondary" size="sm" disabled={!valid}>
						Apply dates
					</Button>
					<p className="pb-2 text-fg-muted text-xs">
						Up to {MAX_RANGE_DAYS} days. End date is included.
					</p>
				</form>
			) : null}
		</>
	);
}
