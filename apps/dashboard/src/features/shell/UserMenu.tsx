"use client";

import { isThemePreference } from "#/shared/theme/theme";
import { useTheme } from "#/shared/theme/ThemeProvider";
import { useSession } from "#/features/auth/session";
import { useState, useTransition } from "react";

import {
	MenuRadioItemIndicator,
	MenuPositioner,
	MenuGroupLabel,
	MenuRadioGroup,
	MenuSeparator,
	MenuRadioItem,
	MenuTrigger,
	MenuPortal,
	MenuPopup,
	MenuGroup,
	MenuRoot,
	MenuItem,
} from "#/components/ui/menu";

import {
	IconDeviceDesktop,
	IconSelector,
	IconLogout,
	IconCheck,
	IconMoon,
	IconSun,
} from "@tabler/icons-react";

export function UserMenu({ collapsed = false }: { collapsed?: boolean }) {
	const { identity, signOut } = useSession();
	const { preference, setPreference } = useTheme();
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
					aria-label={`User menu for ${name}`}
					className="w-full justify-start gap-3 p-2 text-left hover:bg-secondary"
					title={collapsed ? name : undefined}
				>
					<span
						aria-hidden
						className="flex size-8 shrink-0 items-center justify-center rounded-(--ui-radius-control) border border-border/50 bg-card font-semibold text-sm"
					>
						{name.slice(0, 1).toUpperCase()}
					</span>
					{!collapsed && (
						<>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-medium text-sm">
									{name}
								</span>
								<span className="block truncate text-fg-muted text-xs">
									{role}
								</span>
							</span>
							<IconSelector
								aria-hidden
								className="size-4 shrink-0 text-fg-muted"
							/>
						</>
					)}
				</MenuTrigger>
				<MenuPortal>
					<MenuPositioner align="start" side="top" sideOffset={8}>
						<MenuPopup className="w-64">
							<div className="min-w-0 px-3 py-3">
								<p className="truncate font-semibold text-sm">{name}</p>
								<p className="truncate text-fg-muted text-xs">{role}</p>
							</div>
							<MenuSeparator />
							<MenuGroup>
								<MenuGroupLabel>Appearance</MenuGroupLabel>
								<MenuRadioGroup
									onValueChange={(value) => {
										if (isThemePreference(value)) {
											setPreference(value);
										}
									}}
									value={preference}
								>
									{(
										[
											{ value: "light", label: "Light", icon: IconSun },
											{ value: "dark", label: "Dark", icon: IconMoon },
											{
												value: "system",
												label: "System",
												icon: IconDeviceDesktop,
											},
										] as const
									).map(({ value, label, icon: Icon }) => (
										<MenuRadioItem
											className="flex items-center gap-2"
											key={value}
											value={value}
										>
											<Icon aria-hidden className="size-4" />
											<span className="flex-1">{label}</span>
											<MenuRadioItemIndicator>
												<IconCheck aria-hidden className="size-4" />
											</MenuRadioItemIndicator>
										</MenuRadioItem>
									))}
								</MenuRadioGroup>
							</MenuGroup>
							<MenuSeparator />
							<MenuItem
								className="flex items-center gap-2 text-danger"
								disabled={pending}
								onClick={logout}
							>
								<IconLogout aria-hidden className="size-4" />
								{pending ? "Signing out..." : "Sign out"}
							</MenuItem>
						</MenuPopup>
					</MenuPositioner>
				</MenuPortal>
			</MenuRoot>
			{error ? (
				<p className="px-2 py-1 text-danger text-xs" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}
