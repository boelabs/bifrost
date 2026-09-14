"use client";

import { IconDots } from "@tabler/icons-react";
import type { ReactNode } from "react";

import {
	MenuPositioner,
	MenuSeparator,
	MenuTrigger,
	MenuPortal,
	MenuPopup,
	MenuRoot,
	MenuItem,
} from "#/components/ui/menu";

export interface RowAction {
	label: string;
	onSelect: () => void;
	icon?: ReactNode;
	disabled?: boolean;
	/** Destructive and irreversible: set apart below a rule, and coloured. */
	danger?: boolean;
}

/**
 * What can be done to one row, behind one button.
 *
 * A table earns its shape from its data, and a row of four ghost buttons — two of them words, two
 * of them icons, each a different width — is a second table competing with the first. Collapsing
 * them puts every row's trailing edge in the same place, and lets an action be named rather than
 * left to a pictogram nobody hovers.
 *
 * The trigger keeps a stable width whether a row has one action or five, so the column does not
 * jitter as rows change.
 */
export function RowActions({
	actions,
	label,
}: {
	actions: RowAction[];
	/** What this menu acts on, for the operator who cannot see the row it sits in. */
	label: string;
}) {
	if (actions.length === 0) return null;
	// Shown and disabled rather than hidden: "delete" missing from your own row reads as a bug,
	// while "delete" greyed out reads as the rule it is.
	const safe = actions.filter((action) => !action.danger);
	const destructive = actions.filter((action) => action.danger);

	return (
		<MenuRoot>
			<MenuTrigger
				aria-label={label}
				title="Actions"
				className="ml-auto size-8 justify-center p-0 text-fg-muted hover:text-fg"
			>
				<IconDots size={16} aria-hidden />
			</MenuTrigger>
			<MenuPortal>
				<MenuPositioner side="bottom" align="end" sideOffset={6}>
					<MenuPopup className="w-48">
						{safe.map((action) => (
							<MenuItem
								key={action.label}
								disabled={action.disabled ?? false}
								onClick={action.onSelect}
								className="flex items-center gap-2"
							>
								{action.icon}
								{action.label}
							</MenuItem>
						))}
						{destructive.length > 0 && safe.length > 0 ? (
							<MenuSeparator />
						) : null}
						{destructive.map((action) => (
							<MenuItem
								key={action.label}
								disabled={action.disabled ?? false}
								onClick={action.onSelect}
								className="flex items-center gap-2 text-danger"
							>
								{action.icon}
								{action.label}
							</MenuItem>
						))}
					</MenuPopup>
				</MenuPositioner>
			</MenuPortal>
		</MenuRoot>
	);
}
