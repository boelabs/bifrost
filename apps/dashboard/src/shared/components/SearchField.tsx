"use client";

import { IconSearch, IconX } from "@tabler/icons-react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { useEffect, useState } from "react";

/**
 * Search that the gateway performs, not the browser.
 *
 * These tables are one page of a much longer list, so filtering the rows already on screen would
 * search the wrong set. Submitting puts the term in the URL, the loader sends it, and the result is
 * a page of matches from the whole table.
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
	const [draft, setDraft] = useState(value);
	// The URL is the source of truth: back, forward and a shared link all have to move the box.
	useEffect(() => setDraft(value), [value]);

	return (
		<form
			className="flex items-center gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				onSearch(draft.trim());
			}}
		>
			<Input
				aria-label={label}
				size="sm"
				value={draft}
				onValueChange={setDraft}
				placeholder={placeholder}
				className="w-56"
			/>
			{value ? (
				<Button
					type="button"
					size="sm"
					variant="ghost"
					aria-label="Clear search"
					onClick={() => {
						setDraft("");
						onSearch("");
					}}
					mode="icon"
				>
					<IconX size={15} aria-hidden />
				</Button>
			) : null}
			<Button
				type="submit"
				size="sm"
				variant="secondary"
				aria-label={label}
				mode="icon"
			>
				<IconSearch size={15} aria-hidden />
			</Button>
		</form>
	);
}
