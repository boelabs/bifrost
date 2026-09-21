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
				borderRadius="full"
				className="w-56"
				onValueChange={setDraft}
				placeholder={placeholder}
				size="sm"
				value={draft}
			/>
			{value ? (
				<Button
					aria-label="Clear search"
					mode="icon"
					onClick={() => {
						setDraft("");
						onSearch("");
					}}
					size="sm"
					type="button"
					variant="ghost"
				>
					<IconX aria-hidden size={15} />
				</Button>
			) : null}
			<Button
				aria-label={label}
				mode="icon"
				size="sm"
				type="submit"
				variant="secondary"
			>
				<IconSearch aria-hidden size={15} />
			</Button>
		</form>
	);
}
