"use client";

import { isThemePreference } from "#/shared/theme/theme";
import { useTheme } from "#/shared/theme/ThemeProvider";
import { useSession } from "#/features/auth/session";
import { useState } from "react";

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
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string>();
	const name = identity.user.username ?? "Operator";
	const role = identity.user.isRoot
		? `${identity.user.role} · root`
		: identity.user.role;
	async function logout() {
		setPending(true);
		setError(undefined);
		try {
			await signOut();
		} catch {
			setError("Sign out failed. Please try again.");
			setPending(false);
		}
	}
	return (
		<div className="min-w-0">
			<MenuRoot>
				<MenuTrigger
					aria-label={`User menu for ${name}`}
					title={collapsed ? name : undefined}
					className="w-full justify-start gap-3 p-2 text-left hover:bg-secondary"
				>
					<span
						aria-hidden
						className="flex size-8 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] border border-border/50 bg-card text-sm font-semibold"
					>
						{name.slice(0, 1).toUpperCase()}
					</span>
					{!collapsed && (
						<>
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-medium">
									{name}
								</span>
								<span className="block truncate text-xs text-fg-muted">
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
					<MenuPositioner side="top" align="start" sideOffset={8}>
						<MenuPopup className="w-64">
							<div className="min-w-0 px-3 py-3">
								<p className="truncate text-sm font-semibold">{name}</p>
								<p className="truncate text-xs text-fg-muted">{role}</p>
							</div>
							<MenuSeparator />
							<MenuGroup>
								<MenuGroupLabel>Appearance</MenuGroupLabel>
								<MenuRadioGroup
									value={preference}
									onValueChange={(value) => {
										if (isThemePreference(value)) setPreference(value);
									}}
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
											key={value}
											value={value}
											className="flex items-center gap-2"
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
								disabled={pending}
								onClick={() => void logout()}
								className="flex items-center gap-2 text-danger"
							>
								<IconLogout aria-hidden className="size-4" />
								{pending ? "Signing out..." : "Sign out"}
							</MenuItem>
						</MenuPopup>
					</MenuPositioner>
				</MenuPortal>
			</MenuRoot>
			{error && (
				<p role="alert" className="px-2 py-1 text-xs text-danger">
					{error}
				</p>
			)}
		</div>
	);
}
