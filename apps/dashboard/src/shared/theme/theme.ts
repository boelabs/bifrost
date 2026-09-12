export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "bifrost.theme";

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === "system" || value === "light" || value === "dark";
}

export function applyTheme(preference: ThemePreference, systemDark: boolean) {
	document.documentElement.dataset.theme = preference;
	document.documentElement.classList.toggle(
		"dark",
		preference === "dark" || (preference === "system" && systemDark),
	);
}

// A literal keeps the pre-paint script identical across server and client transforms.
export const themeScript = `((storageKey) => {
	let preference = "system";
	try {
		const stored = localStorage.getItem(storageKey);
		if (stored === "light" || stored === "dark" || stored === "system") {
			preference = stored;
		} else if (stored !== null) {
			console.warn("Invalid saved theme preference; using system theme.");
		}
	} catch (error) {
		if (!(error instanceof DOMException) || error.name !== "SecurityError") {
			throw error;
		}
		console.warn("Theme storage is unavailable; using system theme.");
	}
	document.documentElement.dataset.theme = preference;
	document.documentElement.classList.toggle(
		"dark",
		preference === "dark" ||
			(preference === "system" &&
				matchMedia("(prefers-color-scheme: dark)").matches),
	);
})(${JSON.stringify(THEME_STORAGE_KEY)});`;
