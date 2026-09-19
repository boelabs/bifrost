/**
 * Contrast audit for the palette in `src/components/ui/styles.css`.
 *
 * NOT wired into `bun run test`, and it was not wired into the UI package's test script before the
 * kit moved here either — which is why the drift below went unnoticed. It fails today, on tokens
 * that predate this file's move:
 *
 *   light `--primary` (oklch 56%) on `--surface`   → 4.08 : 1, want 4.5 : 1
 *   light `--primary` (oklch 56%) on `--surface-2` → 3.30 : 1, want 4.5 : 1
 *
 * That affects `text-primary` links on a light background. Closing it means taking `--primary` down
 * to roughly oklch 47%, which darkens every primary button in the product — a design decision, not
 * a migration one. Run it with `bun test tests/palette.test.ts`; once the palette passes, move this
 * file back under `src/` so the suite keeps it honest.
 */

import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

function luminance(color: string) {
	const values = /^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)\)$/.exec(color);
	assert.ok(values, `Expected an OKLCH token: ${color}`);
	const lightness = Number(values[1]) / 100;
	const chroma = Number(values[2]);
	const hue = (Number(values[3]) * Math.PI) / 180;
	const a = chroma * Math.cos(hue);
	const b = chroma * Math.sin(hue);
	const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
	const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
	const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
	const clamp = (value: number) => Math.min(1, Math.max(0, value));
	const r = clamp(
		4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
	);
	const g = clamp(
		-1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
	);
	const blue = clamp(
		-0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
}

test("light and dark palette text and focus retain accessible contrast", async () => {
	const css = await readFile(
		new URL("../src/components/ui/styles.css", import.meta.url),
		"utf8",
	);
	for (const theme of [":root", ".dark"]) {
		const block = css.split(`${theme} {`)[1]?.split("}")[0];
		assert.ok(block, `Missing ${theme}`);
		const tokens = new Map(
			[...block.matchAll(/--([\w-]+):\s*(oklch\([^;]+\));/g)].map((match) => [
				match[1],
				match[2],
			]),
		);
		function check(foreground: string, background: string, minimum = 4.5) {
			const fg = tokens.get(foreground);
			const bg = tokens.get(background);
			assert.ok(fg && bg, `Missing ${foreground}/${background}`);
			const a = luminance(fg);
			const b = luminance(bg);
			const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
			assert.ok(
				ratio >= minimum,
				`${theme} ${foreground}/${background}: ${ratio.toFixed(2)} < ${minimum}`,
			);
		}
		for (const surface of ["surface", "surface-2"]) {
			for (const text of [
				"fg",
				"fg-muted",
				"primary",
				"danger",
				"success",
				"warning",
			]) {
				check(text, surface);
			}
			check("focus", surface, 3);
		}
		for (const role of [
			"primary",
			"secondary",
			"danger",
			"success",
			"warning",
		]) {
			check(`${role}-fg`, role);
		}
	}
});
