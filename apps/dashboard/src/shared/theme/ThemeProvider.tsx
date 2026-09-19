"use client";

import { createContext, useContext, useEffect, useState } from "react";

import {
	type ThemePreference,
	isThemePreference,
	THEME_STORAGE_KEY,
	applyTheme,
} from "./theme";

const ThemeContext = createContext<{
	preference: ThemePreference;
	setPreference: (preference: ThemePreference) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [preference, setPreferenceState] = useState<ThemePreference>("system");

	useEffect(() => {
		const media = matchMedia("(prefers-color-scheme: dark)");
		const initial = document.documentElement.dataset.theme;
		if (isThemePreference(initial)) {
			setPreferenceState(initial);
			applyTheme(initial, media.matches);
		}
		function onSystemChange() {
			const current = document.documentElement.dataset.theme;
			if (isThemePreference(current)) {
				applyTheme(current, media.matches);
			}
		}
		function onStorage(event: StorageEvent) {
			if (event.key !== THEME_STORAGE_KEY && event.key !== null) {
				return;
			}
			if (event.storageArea !== localStorage) {
				return;
			}
			if (event.newValue !== null && !isThemePreference(event.newValue)) {
				console.warn("Invalid saved theme preference; using system theme.");
			}
			const next = isThemePreference(event.newValue)
				? event.newValue
				: "system";
			setPreferenceState(next);
			applyTheme(next, media.matches);
		}
		media.addEventListener("change", onSystemChange);
		window.addEventListener("storage", onStorage);
		return () => {
			media.removeEventListener("change", onSystemChange);
			window.removeEventListener("storage", onStorage);
		};
	}, []);

	function setPreference(next: ThemePreference) {
		try {
			localStorage.setItem(THEME_STORAGE_KEY, next);
		} catch (error) {
			if (
				!(error instanceof DOMException) ||
				(error.name !== "SecurityError" && error.name !== "QuotaExceededError")
			) {
				throw error;
			}
			console.warn(
				"Theme preference could not be saved; it applies to this tab only.",
			);
		}
		setPreferenceState(next);
		applyTheme(next, matchMedia("(prefers-color-scheme: dark)").matches);
	}

	return (
		<ThemeContext.Provider value={{ preference, setPreference }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function useTheme() {
	const theme = useContext(ThemeContext);
	if (!theme) {
		throw new Error("useTheme must be used within ThemeProvider");
	}
	return theme;
}
