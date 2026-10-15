"use client";

import { isThemePreference } from "#/shared/theme/theme";
import { useTheme } from "#/shared/theme/ThemeProvider";
import { useShowShortcuts } from "./KeyboardShortcuts";
import { useSession } from "#/features/auth/session";
import { useState, useTransition } from "react";

import {
	MenuRadioItemIndicator,
	MenuPositioner,
	MenuRadioGroup,
	MenuSeparator,
	MenuRadioItem,
	MenuTrigger,
	MenuPortal,
	MenuPopup,
	MenuRoot,
	MenuItem,
} from "#/components/ui/menu";

import {
	ChevronsUpDownIcon,
	KeyboardIcon,
	LogOutIcon,
	CheckIcon,
} from "lucide-react";

const THEMES = [
	{ value: "light", label: "Light theme" },
	{ value: "dark", label: "Dark theme" },
	{ value: "system", label: "Automatic" },
] as const;

/**
 * Who is signed in, at the foot of the sidebar: their name opens, upward, the theme, the keyboard
 * shortcuts and signing out.
 */
export function UserMenu() {
	const { identity, signOut } = useSession();
	const { preference, setPreference } = useTheme();
	const showShortcuts = useShowShortcuts();
	/**
	 * Signing out is a transition, not a flag that is set and never cleared.
	 *
	 * A `pending` boolean left `true` because "the page is leaving anyway" is only true while the page
	 * actually leaves. This one did not: the router used to keep the tree it navigated away from and
	 * show it again, React state and all, when the tab signed back in — and the menu item read
	 * "Signing out…", disabled, for an operator who had only just arrived. `signOut` loads a document
	 * now (`features/auth/session.tsx`), and the transition runs for exactly as long as the work does:
	 * until the sign-out fails, or until that document replaces this one.
	 */
	const [pending, startSigningOut] = useTransition();
	const [error, setError] = useState<string>();
	const name = identity.user.username ?? "Operator";
	const role = identity.user.isRoot
		? `${identity.user.role} · root`
		: identity.user.role;
	function logout() {
		setError(undefined);
		startSigningOut(async () => {
			try {
				await signOut();
			} catch {
				setError("Sign out failed. Please try again.");
			}
		});
	}
	return (
		<div className="min-w-0">
			<MenuRoot>
				<MenuTrigger
					aria-label={`Your account: ${name}`}
					className="group flex w-full items-center gap-2 rounded-lg p-2 text-start outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent"
				>
					<span
						aria-hidden
						className="flex size-6 shrink-0 select-none items-center justify-center rounded-full bg-muted font-medium text-[0.6875rem]"
					>
						{name.slice(0, 1).toUpperCase()}
					</span>
					<span className="min-w-0 flex-1 truncate font-medium text-sm">
						{name}
					</span>
					<ChevronsUpDownIcon
						aria-hidden
						className="size-4 shrink-0 text-muted-foreground"
					/>
				</MenuTrigger>
				<MenuPortal>
					<MenuPositioner align="start" side="top" sideOffset={6}>
						<MenuPopup className="w-(--anchor-width) min-w-56 max-w-(--available-width)">
							<div className="flex min-w-0 flex-col px-2 py-1.5">
								<span className="truncate font-medium text-sm">{name}</span>
								<span className="truncate text-muted-foreground text-xs">
									{role}
								</span>
							</div>
							<MenuSeparator />
							<MenuRadioGroup
								onValueChange={(value) => {
									if (isThemePreference(value)) {
										setPreference(value);
									}
								}}
								value={preference}
							>
								{THEMES.map(({ value, label }) => (
									<MenuRadioItem
										className="flex items-center gap-2"
										key={value}
										value={value}
									>
										<span className="flex-1">{label}</span>
										<MenuRadioItemIndicator>
											<CheckIcon aria-hidden className="size-4" />
										</MenuRadioItemIndicator>
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
							<MenuSeparator />
							<MenuItem
								className="flex items-center gap-2"
								onClick={showShortcuts}
							>
								<KeyboardIcon aria-hidden className="size-4" />
								<span className="flex-1">Keyboard shortcuts</span>
								<kbd className="font-sans text-muted-foreground text-xs">?</kbd>
							</MenuItem>
							<MenuSeparator />
							<MenuItem
								className="flex items-center gap-2 text-destructive-foreground"
								disabled={pending}
								onClick={logout}
							>
								<LogOutIcon aria-hidden className="size-4" />
								{pending ? "Signing out…" : "Sign out"}
							</MenuItem>
						</MenuPopup>
					</MenuPositioner>
				</MenuPortal>
			</MenuRoot>
			{error ? (
				<p
					className="px-2 py-1 text-destructive-foreground text-xs"
					role="alert"
				>
					{error}
				</p>
			) : null}
		</div>
	);
}
