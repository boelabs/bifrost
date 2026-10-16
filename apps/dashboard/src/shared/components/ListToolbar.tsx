"use client";

import { SlidersHorizontal, ArrowDownUp, ListFilter } from "lucide-react";
import { Button } from "#/components/ui/button";
import { cn } from "#/shared/lib/classes";
import type { ReactNode } from "react";

import {
	SheetTrigger,
	SheetHeader,
	SheetFooter,
	SheetPopup,
	SheetTitle,
	SheetClose,
	SheetPanel,
	Sheet,
} from "#/components/ui/sheet";

import {
	SelectTrigger,
	SelectPopup,
	SelectValue,
	SelectItem,
	Select,
} from "#/components/ui/primitives/select";

export interface ListOption {
	value: string;
	label: string;
}

/**
 * One choice of a list — its segments (*All keys, Enabled, Disabled*) or its order — as Billete's:
 * a select with an icon, 11rem wide from a 40rem toolbar up, however many options there are.
 * Choosing the first option is the list's default.
 */
export function ListSelect({
	kind,
	label,
	options,
	value,
	onValueChange,
	className,
}: {
	/** `segment` shows the filter icon, `sort` the arrows. */
	kind: "segment" | "sort";
	label: string;
	options: readonly ListOption[];
	value: string;
	onValueChange: (value: string) => void;
	className?: string;
}) {
	const Icon = kind === "segment" ? ListFilter : ArrowDownUp;
	return (
		<Select
			items={options}
			modal={false}
			onValueChange={(next) => {
				if (typeof next === "string") {
					onValueChange(next);
				}
			}}
			value={value}
		>
			<SelectTrigger
				aria-label={label}
				className={cn(
					"@min-[40rem]:w-44 min-w-0 @min-[40rem]:flex-none flex-1",
					className,
				)}
			>
				<Icon aria-hidden="true" />
				<SelectValue />
			</SelectTrigger>
			<SelectPopup>
				{options.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectPopup>
		</Select>
	);
}

/**
 * Phones have no room for the selects beside the search: *Filters* holds them in a panel from the
 * bottom, as Billete's does. Each applies at once, as in the toolbar.
 */
function FiltersSheet({ children }: { children: ReactNode }) {
	return (
		<Sheet>
			<SheetTrigger
				render={<Button className="@min-[40rem]:hidden" variant="secondary" />}
			>
				<SlidersHorizontal aria-hidden="true" />
				Filters
			</SheetTrigger>
			<SheetPopup side="bottom">
				<SheetHeader>
					<SheetTitle>Filters</SheetTitle>
				</SheetHeader>
				<SheetPanel>
					<div className="flex flex-col gap-3 *:w-full *:flex-none">
						{children}
					</div>
				</SheetPanel>
				<SheetFooter>
					<SheetClose render={<Button />}>Show results</SheetClose>
				</SheetFooter>
			</SheetPopup>
		</Sheet>
	);
}

/**
 * Above a list, Billete's: its segments and order on one side; its search, filters and actions on
 * the other. Both share a row when the toolbar (not the window: the sidebar takes part of it) fits
 * them, and wrap otherwise. Under 40rem the selects move into *Filters*, beside the search.
 */
export function ListToolbar({
	selects,
	controls,
}: {
	selects?: ReactNode;
	controls?: ReactNode;
}) {
	return (
		<div className="@container flex flex-col gap-3" data-slot="list-toolbar">
			<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
				{selects ? (
					<div className="@min-[40rem]:flex hidden min-w-0 flex-wrap items-center gap-2">
						{selects}
					</div>
				) : (
					<span aria-hidden="true" className="@min-[40rem]:block hidden" />
				)}
				{controls || selects ? (
					<div className="flex @min-[40rem]:w-auto w-full min-w-0 flex-wrap items-center gap-2">
						{controls}
						{selects ? <FiltersSheet>{selects}</FiltersSheet> : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
