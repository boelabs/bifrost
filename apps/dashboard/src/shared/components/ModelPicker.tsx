"use client";

import { Combobox } from "#/components/ui/combobox";
import { Field } from "#/components/ui/field";
import { ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";

/**
 * Public model names are free text, not a closed set: a key may be scoped to a model that is planned
 * but not deployed yet, and a fallback chain may name one whose only deployment is currently
 * disabled. So both pickers here suggest what exists and still accept what does not — typing a name
 * nobody has deployed is allowed, it is just never the first thing offered.
 */
function suggestions(known: readonly string[], selected: readonly string[]) {
	return [...new Set([...known, ...selected])].sort((a, b) =>
		a.localeCompare(b),
	);
}

/**
 * One model, typed or picked.
 *
 * The typed text *is* the value — there is no separate "selected item" that a half-finished entry
 * could fall out of — so a name the operator types and never confirms from the list still saves.
 */
export function ModelInput({
	value,
	onChange,
	models,
	label = "Public model",
	description,
	required,
	autoFocus,
	name,
	placeholder = "Pick or type a model",
	searchPlaceholder = "Search or type a model",
	emptyHint = "No deployed model matches. The name is still accepted.",
	renderItem = (model) => model,
}: {
	value: string;
	onChange: (value: string) => void;
	models: readonly string[];
	label?: string;
	description?: string;
	required?: boolean;
	autoFocus?: boolean;
	name?: string;
	placeholder?: string;
	searchPlaceholder?: string;
	emptyHint?: string;
	renderItem?: (model: string) => React.ReactNode;
}) {
	const items = useMemo(() => suggestions(models, []), [models]);
	const [query, setQuery] = useState("");
	return (
		<Field.Root name={name}>
			<Field.Label>{label}</Field.Label>
			<Combobox.Root
				inputValue={query}
				items={items}
				onInputValueChange={(next, details) => {
					setQuery(next);
					if (
						details.reason === "input-change" ||
						details.reason === "input-clear"
					) {
						onChange(next);
					}
				}}
				onOpenChange={(open) => {
					if (!open) {
						setQuery("");
					}
				}}
				onValueChange={(next: string | null) => onChange(next ?? "")}
				required={required}
				value={value}
			>
				<Combobox.Trigger
					aria-label={label}
					autoFocus={autoFocus}
					className="w-full justify-between font-normal"
				>
					<span className="truncate">{value || placeholder}</span>
					<ChevronsUpDown
						aria-hidden
						className="size-4 shrink-0 text-fg-muted"
					/>
				</Combobox.Trigger>
				<Combobox.Portal>
					<Combobox.Positioner className="z-50" sideOffset={6}>
						<Combobox.Popup
							aria-label={label}
							className="max-w-[calc(100vw-2rem)] p-0"
						>
							<Combobox.SearchInput placeholder={searchPlaceholder} />
							<Combobox.Empty>{emptyHint}</Combobox.Empty>
							<Combobox.List className="p-1">
								{(id: string) => (
									<Combobox.Item key={id} value={id}>
										{renderItem(id)}
										<Combobox.ItemIndicator />
									</Combobox.Item>
								)}
							</Combobox.List>
						</Combobox.Popup>
					</Combobox.Positioner>
				</Combobox.Portal>
			</Combobox.Root>
			{description ? (
				<Field.Description>{description}</Field.Description>
			) : null}
			<Field.Error />
		</Field.Root>
	);
}

/**
 * Several models, kept in the order they were added — which is what a fallback chain means by
 * "tried in order", and what an allowed-model list can safely ignore.
 */
export function ModelListInput({
	value,
	onChange,
	models,
	label,
	description,
	placeholder = "Select models",
	emptyHint = "Type a model name and press Enter to add it.",
}: {
	value: readonly string[];
	onChange: (value: string[]) => void;
	models: readonly string[];
	label: string;
	description?: string;
	placeholder?: string;
	emptyHint?: string;
}) {
	const [query, setQuery] = useState("");
	const typed = query.trim();
	const items = useMemo(() => {
		const known = suggestions(models, value);
		// The typed name itself is offered as an item, which is what makes a model nobody deployed
		// selectable with the same keystroke as one that exists.
		return typed && !known.includes(typed) ? [typed, ...known] : known;
	}, [models, value, typed]);

	return (
		<Field.Root>
			<Field.Label>{label}</Field.Label>
			<Combobox.Root
				inputValue={query}
				items={items}
				multiple
				onInputValueChange={setQuery}
				onOpenChange={(open, details) => {
					// Picking an item would close the popup; several names usually go in at once.
					if (!open && details.reason === "item-press") {
						details.cancel();
					} else if (!open) {
						setQuery("");
					}
				}}
				onValueChange={(next: string[]) => {
					onChange([
						...new Set(next.map((entry) => entry.trim()).filter(Boolean)),
					]);
					setQuery("");
				}}
				value={value as string[]}
			>
				<Combobox.Value>
					{(selected: string[]) => (
						<Combobox.Chips
							aria-label={selected.length > 0 ? label : undefined}
							className="gap-1.5 pr-2"
						>
							{selected.map((model) => (
								<Combobox.Chip
									aria-description="Press Backspace or Delete to remove"
									aria-label={model}
									key={model}
								>
									{model}
									<Combobox.ChipRemove aria-label={`Remove ${model}`} />
								</Combobox.Chip>
							))}
							<Combobox.InlineTrigger
								aria-label={`Show models for ${label}`}
								className="h-auto min-w-0 flex-1 justify-between gap-2 px-1 font-normal text-sm"
							>
								<span className="truncate">
									{selected.length > 0 ? "Add a model" : null}
									{selected.length === 0 ? placeholder : null}
								</span>
								<ChevronsUpDown aria-hidden className="size-4 shrink-0" />
							</Combobox.InlineTrigger>
						</Combobox.Chips>
					)}
				</Combobox.Value>
				<Combobox.Portal>
					<Combobox.Positioner className="z-50" sideOffset={6}>
						<Combobox.Popup
							aria-label={label}
							className="max-w-[calc(100vw-2rem)] p-0"
						>
							<Combobox.SearchInput placeholder="Search or type a model" />
							<Combobox.Empty>{emptyHint}</Combobox.Empty>
							<Combobox.List className="p-1">
								{(model: string) => (
									<Combobox.Item key={model} value={model}>
										{model}
										<Combobox.ItemIndicator />
									</Combobox.Item>
								)}
							</Combobox.List>
						</Combobox.Popup>
					</Combobox.Positioner>
				</Combobox.Portal>
			</Combobox.Root>
			{description ? (
				<Field.Description>{description}</Field.Description>
			) : null}
		</Field.Root>
	);
}
