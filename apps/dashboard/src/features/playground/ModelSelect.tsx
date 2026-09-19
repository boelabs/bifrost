"use client";

import { IconSearch, IconSelector } from "@tabler/icons-react";
import { Combobox } from "#/components/ui/combobox";
import type { Capability } from "./capabilities";
import { useMemo, useState } from "react";

import {
	type CapabilityGroup,
	type PlaygroundModel,
	type ModelChoice,
	capabilityGroups,
	choiceKey,
} from "./models";

/**
 * The model picker: a select that can be searched, grouped by what the model can do.
 *
 * It is a combobox rather than a select because a gateway's catalog is as long as its operators
 * made it — scrolling a hundred names to find one is not a picker. The query filters inside the
 * groups, so the capability a match belongs to stays visible while typing.
 *
 * The value is the *pair*: a model that both generates text and generates images appears in both
 * groups, and which of the two was picked is the choice being made.
 */
export function ModelSelect({
	models,
	capability,
	modelId,
	onSelect,
}: {
	models: PlaygroundModel[];
	capability: Capability;
	modelId: string;
	onSelect: (choice: ModelChoice) => void;
}) {
	const [query, setQuery] = useState("");
	const groups = useMemo(() => capabilityGroups(models), [models]);
	const selected = useMemo(() => {
		const key = choiceKey(capability, modelId);
		return groups
			.flatMap((group) => group.items)
			.find((item) => item.key === key);
	}, [groups, capability, modelId]);
	const multipleGroups = groups.length > 1;

	return (
		<Combobox.Root<ModelChoice>
			inputValue={query}
			isItemEqualToValue={(choice, value) => choice.key === value.key}
			items={groups}
			itemToStringLabel={(choice) => choice.model.id}
			onInputValueChange={setQuery}
			onOpenChange={(open) => {
				// The query is about finding a model, not about naming one: a closed popup starts over.
				if (!open) {
					setQuery("");
				}
			}}
			onValueChange={(choice) => {
				if (choice) {
					onSelect(choice);
				}
			}}
			value={selected ?? null}
		>
			<Combobox.Trigger
				aria-label="Model"
				className="max-w-52 justify-between gap-1 font-medium text-sm"
				size="sm"
				variant="ghost"
			>
				<span className="truncate">
					{selected?.model.id ?? "Select a model"}
				</span>
				<IconSelector aria-hidden className="size-4 shrink-0 text-fg-muted" />
			</Combobox.Trigger>
			<Combobox.Portal>
				<Combobox.Positioner align="start" className="z-50" sideOffset={6}>
					<Combobox.Popup className="w-80 max-w-[calc(100vw-2rem)] p-0">
						<div className="flex items-center gap-2 border-border/60 border-b px-3">
							<IconSearch
								aria-hidden
								className="size-4 shrink-0 text-fg-muted"
							/>
							{/* The bare input: the row around it is the field, so a second border would nest. */}
							<Combobox.ChipsInput
								aria-label="Search models"
								className="min-h-10 w-full text-sm"
								placeholder="Search models"
							/>
						</div>
						<Combobox.Empty>No model matches that name.</Combobox.Empty>
						<Combobox.List className="max-h-80 p-1">
							{(group: CapabilityGroup) => (
								<Combobox.Group
									className="pb-1 last:pb-0"
									items={group.items}
									key={group.capability}
								>
									{/* One group is no grouping: the label would only repeat the page. */}
									{multipleGroups ? (
										<Combobox.GroupLabel className="px-3 py-1.5 text-fg-muted text-xs">
											{group.label}
										</Combobox.GroupLabel>
									) : null}
									<Combobox.Collection>
										{(choice: ModelChoice) => (
											<Combobox.Item
												className="gap-2"
												key={choice.key}
												value={choice}
											>
												<span className="min-w-0 flex-1 truncate">
													{choice.model.id}
												</span>
												<Combobox.ItemIndicator />
											</Combobox.Item>
										)}
									</Combobox.Collection>
								</Combobox.Group>
							)}
						</Combobox.List>
					</Combobox.Popup>
				</Combobox.Positioner>
			</Combobox.Portal>
		</Combobox.Root>
	);
}
