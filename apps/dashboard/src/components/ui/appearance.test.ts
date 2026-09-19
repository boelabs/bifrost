import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
	appearanceStyle,
	mergeClassName,
	controlStyles,
	mergeStyle,
} from "./appearance.ts";

describe("shared component appearance", () => {
	test("resolves radius tokens and full width", () => {
		assert.deepEqual(appearanceStyle({ borderRadius: "lg", width: "full" }), {
			borderRadius: "var(--ui-radius-lg)",
			width: "100%",
		});
		assert.deepEqual(appearanceStyle({ borderRadius: "none", width: "auto" }), {
			borderRadius: "0px",
			width: "auto",
		});
	});

	test("preserves custom CSS values, numeric zero and stylesheet defaults", () => {
		assert.deepEqual(
			appearanceStyle({ borderRadius: "1.25rem", width: "min(100%, 30rem)" }),
			{ borderRadius: "1.25rem", width: "min(100%, 30rem)" },
		);
		assert.deepEqual(appearanceStyle({ borderRadius: 0, width: 0 }), {
			borderRadius: 0,
			width: 0,
		});
		assert.deepEqual(appearanceStyle({ borderRadius: null, width: null }), {});
		assert.deepEqual(appearanceStyle({}), {});
	});

	test("explicit styles override appearance and keep unrelated styles", () => {
		assert.deepEqual(
			appearanceStyle(
				{ borderRadius: "full", width: "full" },
				{ borderRadius: 4, width: 200, opacity: 0.5 },
			),
			{ borderRadius: 4, width: 200, opacity: 0.5 },
		);
	});

	test("preserves Base UI state-dependent style callbacks", () => {
		const style = mergeStyle(
			{ width: "full" },
			(state: { disabled: boolean }) => ({ opacity: state.disabled ? 0.5 : 1 }),
		);
		assert.equal(typeof style, "function");
		if (typeof style !== "function") {
			throw new Error("Expected a style callback");
		}
		assert.deepEqual(style({ disabled: true }), {
			width: "100%",
			opacity: 0.5,
		});
	});

	test("custom Tailwind classes override shared defaults, including callbacks", () => {
		assert.equal(
			mergeClassName("rounded-lg p-2", "rounded-none p-4"),
			"rounded-none p-4",
		);
		const classes = mergeClassName("p-2", (state: { disabled: boolean }) =>
			state.disabled ? "p-4" : undefined,
		);
		if (typeof classes !== "function") {
			throw new Error("Expected a class callback");
		}
		assert.equal(classes({ disabled: true }), "p-4");
		assert.equal(classes({ disabled: false }), "p-2");
	});

	test("all field sizes share the same radius, with a 48px default", () => {
		for (const size of ["xs", "sm", "md", "lg"] as const) {
			assert.ok(
				controlStyles({ size }).includes("rounded-[var(--ui-radius-control)]"),
			);
		}
		assert.ok(controlStyles().includes("min-h-12"));
	});
});
