"use client";

import { Select, SelectItem } from "#/components/ui/select";
import type { ThemePreference } from "./theme";
import { useTheme } from "./ThemeProvider";

export function ThemeSelect() {
	const { preference, setPreference } = useTheme();
	return (
		<Select<ThemePreference>
			aria-label="Color theme"
			value={preference}
			onValueChange={(value) => {
				if (value !== null) setPreference(value);
			}}
			size="sm"
			width="full"
		>
			<SelectItem value="system">System</SelectItem>
			<SelectItem value="light">Light</SelectItem>
			<SelectItem value="dark">Dark</SelectItem>
		</Select>
	);
}
