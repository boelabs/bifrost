"use client";

import { useSession } from "#/features/auth/session.tsx";
import { visibleCreateActions } from "./navigation.ts";
import { Button } from "#/components/ui/button";
import { PlusIcon } from "lucide-react";
import Link from "next/link";

import {
	MenuGroupLabel,
	MenuShortcut,
	MenuTrigger,
	MenuPopup,
	MenuGroup,
	MenuItem,
	Menu,
} from "#/components/ui/primitives/menu";

/**
 * Billete's "+" beside the search: what the operator's role can create, each with its shortcut.
 * Items navigate, never mutate. Nothing for a role that creates nothing.
 */
export function CreateMenu({ onNavigate }: { onNavigate?: () => void }) {
	const { can } = useSession();
	const actions = visibleCreateActions(can);
	if (actions.length === 0) {
		return null;
	}
	return (
		<Menu>
			<MenuTrigger
				render={
					<Button
						aria-label="Create"
						className="text-muted-foreground"
						mode="icon"
						title="Create"
						variant="ghost"
					/>
				}
			>
				<PlusIcon aria-hidden="true" />
			</MenuTrigger>
			<MenuPopup align="end" className="min-w-52">
				<MenuGroup>
					<MenuGroupLabel>Create</MenuGroupLabel>
					{actions.map((action) => {
						const Icon = action.icon;
						return (
							<MenuItem
								key={action.href}
								onClick={onNavigate}
								render={<Link href={action.href} />}
							>
								<Icon aria-hidden="true" />
								{action.label}
								{action.key ? (
									<MenuShortcut>C {action.key.toUpperCase()}</MenuShortcut>
								) : null}
							</MenuItem>
						);
					})}
				</MenuGroup>
			</MenuPopup>
		</Menu>
	);
}
