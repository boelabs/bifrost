"use client";

import { useDebouncedValue } from "#/shared/lib/useDebouncedValue.ts";
import { Search as IconSearch, X as IconX } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";

/**
 * A list's search box, Billete's: it asks once the operator pauses (300 ms), and a clear button
 * empties it. `value` is what the list searches now; the box keeps what is being typed.
 *
 * The gateway searches, not the browser: these tables are one page of a much longer list, so the
 * term goes into the URL, the loader sends it, and the result is a page of matches from the whole
 * table.
 */
export function SearchField({
	value,
	onSearch,
	placeholder = "Search",
	label,
}: {
	value: string;
	onSearch: (value: string) => void;
	placeholder?: string;
	label: string;
}) {
	const [text, setText] = useState(value);
	// The URL changed from elsewhere (back, a link, clearing filters): the box follows it.
	const [seen, setSeen] = useState(value);
	if (value !== seen) {
		setSeen(value);
		if (value !== text.trim()) {
			setText(value);
		}
	}
	const settled = useDebouncedValue(text.trim(), 300);
	// Only a pause in typing searches; a new `value` from outside does not echo back.
	const search = useEffectEvent((next: string) => {
		if (next !== value) {
			onSearch(next);
		}
	});
	useEffect(() => search(settled), [settled]);

	return (
		<div className="relative w-full min-w-0 sm:w-64">
			<IconSearch
				aria-hidden
				className="pointer-events-none absolute start-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				aria-label={label}
				className="ps-9 pe-9"
				maxLength={100}
				onValueChange={setText}
				placeholder={placeholder}
				type="search"
				value={text}
			/>
			{text ? (
				<Button
					aria-label="Clear search"
					className="absolute end-1 top-1/2 z-10 -translate-y-1/2"
					mode="icon"
					onClick={() => {
						setText("");
						onSearch("");
					}}
					size="xs"
					type="button"
					variant="ghost"
				>
					<IconX aria-hidden className="size-3.5" />
				</Button>
			) : null}
		</div>
	);
}
