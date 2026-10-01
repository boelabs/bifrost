"use client";

import { Select, SelectItem } from "#/components/ui/select";
import { MoonIcon, SunIcon, CheckIcon } from "lucide-react";
import { Button } from "#/components/ui/button";
import type { ThemePreference } from "./theme";
import { useTheme } from "./ThemeProvider";

import {
	MenuRadioItemIndicator,
	MenuPositioner,
	MenuRadioGroup,
	MenuRadioItem,
	MenuTrigger,
	MenuPortal,
	MenuPopup,
	MenuRoot,
} from "#/components/ui/menu";

export function ThemeSelect({ compact = false }: { compact?: boolean }) {
	const { preference, setPreference } = useTheme();
	if (compact) {
		return (
			<MenuRoot>
				<MenuTrigger
					render={
						<Button aria-label="Color theme" mode="icon" variant="ghost" />
					}
				>
					<SunIcon aria-hidden className="hidden dark:inline" />
					<MoonIcon aria-hidden className="dark:hidden" />
				</MenuTrigger>
				<MenuPortal>
					<MenuPositioner align="end" sideOffset={4}>
						<MenuPopup>
							<MenuRadioGroup
								onValueChange={(value) => {
									if (
										value === "system" ||
										value === "light" ||
										value === "dark"
									) {
										setPreference(value);
									}
								}}
								value={preference}
							>
								{(["system", "light", "dark"] as const).map((value) => (
									<MenuRadioItem key={value} value={value}>
										{value[0].toUpperCase() + value.slice(1)}
										<MenuRadioItemIndicator>
											<CheckIcon aria-hidden className="size-4" />
										</MenuRadioItemIndicator>
									</MenuRadioItem>
								))}
							</MenuRadioGroup>
						</MenuPopup>
					</MenuPositioner>
				</MenuPortal>
			</MenuRoot>
		);
	}
	return (
		<Select<ThemePreference>
			aria-label="Color theme"
			onValueChange={(value) => {
				if (value !== null) {
					setPreference(value);
				}
			}}
			size="sm"
			value={preference}
			width="full"
		>
			<SelectItem value="system">System</SelectItem>
			<SelectItem value="light">Light</SelectItem>
			<SelectItem value="dark">Dark</SelectItem>
		</Select>
	);
}
