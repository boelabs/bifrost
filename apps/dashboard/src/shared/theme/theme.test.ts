import { isThemePreference, themeScript, THEME_STORAGE_KEY } from "./theme";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import { test } from "node:test";

test("theme preferences accept only the supported modes", () => {
	for (const value of ["system", "light", "dark"]) {
		assert.equal(isThemePreference(value), true);
	}
	for (const value of [null, undefined, "", "auto", "DARK"]) {
		assert.equal(isThemePreference(value), false);
	}
});

test("the pre-paint script resolves saved and system themes without application imports", () => {
	for (const stored of [null, "system", "light", "dark", "invalid"]) {
		for (const systemDark of [false, true]) {
			let dark = false;
			const warnings: string[] = [];
			const dataset: Record<string, string> = {};
			runInNewContext(themeScript, {
				localStorage: {
					getItem(key: string) {
						assert.equal(key, THEME_STORAGE_KEY);
						return stored;
					},
				},
				matchMedia: (query: string) => {
					assert.equal(query, "(prefers-color-scheme: dark)");
					return { matches: systemDark };
				},
				document: {
					documentElement: {
						dataset,
						classList: {
							toggle(name: string, enabled: boolean) {
								assert.equal(name, "dark");
								dark = enabled;
							},
						},
					},
				},
				console: { warn: (message: string) => warnings.push(message) },
			});
			const preference = isThemePreference(stored) ? stored : "system";
			assert.equal(dataset.theme, preference);
			assert.equal(
				dark,
				preference === "dark" || (preference === "system" && systemDark),
			);
			assert.equal(warnings.length, stored === "invalid" ? 1 : 0);
		}
	}
});

test("blocked storage is reported and does not prevent system theme initialization", () => {
	const dataset: Record<string, string> = {};
	let warned = false;
	runInNewContext(themeScript, {
		DOMException,
		localStorage: {
			getItem() {
				throw new DOMException("Blocked", "SecurityError");
			},
		},
		matchMedia: () => ({ matches: true }),
		document: {
			documentElement: {
				dataset,
				classList: {
					toggle() {
						/* intentionally empty */
					},
				},
			},
		},
		console: {
			warn() {
				warned = true;
			},
		},
	});
	assert.equal(dataset.theme, "system");
	assert.equal(warned, true);
});
