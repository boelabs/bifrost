"use client";

import { TextSkeleton } from "#/shared/components/TextSkeleton";
import { isThemePreference } from "#/shared/theme/theme";
import { useTheme } from "#/shared/theme/ThemeProvider";
import { useShowShortcuts } from "./KeyboardShortcuts";
import { useSession } from "#/features/auth/session";
import { useState, useTransition } from "react";
import Link from "next/link";

import {
	MenuRadioGroup,
	MenuSeparator,
	MenuRadioItem,
	MenuShortcut,
	MenuTrigger,
	MenuPopup,
	MenuItem,
	Menu,
} from "#/components/ui/primitives/menu";

import {
	ChevronsUpDownIcon,
	SettingsIcon,
	KeyboardIcon,
	LogOutIcon,
} from "lucide-react";

/**
 * The foot while the gateway says who is signed in: the trigger's own row, so nothing moves when
 * the name arrives. The name is the one thing not known yet, so it is the only placeholder.
 */
export function UserMenuFallback() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading account"
			className="flex items-center gap-2 p-2"
			role="status"
		>
			<span
				aria-hidden="true"
				className="size-6 shrink-0 rounded-full bg-primary/10"
			/>
			<span className="min-w-0 flex-1 text-sm">
				<TextSkeleton length={10} />
			</span>
			<ChevronsUpDownIcon
				aria-hidden="true"
				className="size-4 shrink-0 text-muted-foreground"
			/>
		</div>
	);
}

const THEMES = [
	{ value: "light", label: "Light theme" },
	{ value: "dark", label: "Dark theme" },
	{ value: "system", label: "Automatic" },
] as const;

/**
 * Who is signed in, at the foot of the sidebar, as Billete's: their name opens, upward, the theme,
 * Settings, the keyboard shortcuts and signing out.
 */
export function UserMenu({ onNavigate }: { onNavigate?: () => void }) {
	const { identity, signOut, can } = useSession();
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
			<Menu>
				<MenuTrigger
					aria-label={`Your account: ${name}`}
					className="group flex w-full items-center gap-2 rounded-lg p-2 text-start outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-accent"
				>
					<span
						aria-hidden="true"
						className="flex size-6 shrink-0 select-none items-center justify-center rounded-full bg-primary/10 font-medium text-[0.6875rem] text-primary"
					>
						{name.slice(0, 1).toUpperCase()}
					</span>
					<span className="min-w-0 flex-1 truncate font-medium text-sm">
						{name}
					</span>
					<ChevronsUpDownIcon
						aria-hidden="true"
						className="size-4 shrink-0 text-muted-foreground"
					/>
				</MenuTrigger>
				<MenuPopup
					align="start"
					className="w-(--anchor-width) min-w-56 max-w-(--available-width)"
					side="top"
					sideOffset={6}
				>
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
						{THEMES.map((theme) => (
							<MenuRadioItem key={theme.value} value={theme.value}>
								{theme.label}
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
					<MenuSeparator />
					{can("settings:read") ? (
						<MenuItem onClick={onNavigate} render={<Link href="/settings" />}>
							<SettingsIcon aria-hidden="true" />
							Settings
							<MenuShortcut>G ,</MenuShortcut>
						</MenuItem>
					) : null}
					<MenuItem onClick={showShortcuts}>
						<KeyboardIcon aria-hidden="true" />
						Keyboard shortcuts
						<MenuShortcut>?</MenuShortcut>
					</MenuItem>
					<MenuSeparator />
					<MenuItem disabled={pending} onClick={logout} variant="destructive">
						<LogOutIcon aria-hidden="true" />
						{pending ? "Signing out…" : "Sign out"}
					</MenuItem>
				</MenuPopup>
			</Menu>
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
