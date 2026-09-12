import { describe, expect, test } from "bun:test";
import type { VirtualKey } from "./common.ts";

import {
	centsToDollars,
	dollarsToCents,
	draftFromKey,
	toCreateBody,
	toUpdateBody,
	EMPTY_DRAFT,
	isoToLocal,
	localToIso,
} from "./draft.ts";

const key: VirtualKey = {
	id: "00000000-0000-4000-8000-000000000000",
	name: "ci",
	keyPrefix: "bk_live_abc",
	createdBy: "user:root",
	allowedModels: ["general"],
	maxBudgetCents: 5_000,
	budgetReset: "monthly",
	budgetResetAt: null,
	spendCents: "1200.0000000000",
	tpm: null,
	rpm: 60,
	enabled: true,
	expiresAt: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("money", () => {
	test("dollars round to whole cents", () => {
		expect(dollarsToCents("12.345")).toBe(1235);
		expect(dollarsToCents("0")).toBe(0);
	});

	test("an empty budget is absent, not zero", () => {
		expect(dollarsToCents("")).toBeNull();
		expect(dollarsToCents("   ")).toBeNull();
		expect(centsToDollars(null)).toBe("");
	});

	test("negatives and nonsense are treated as unset", () => {
		expect(dollarsToCents("-5")).toBeNull();
		expect(dollarsToCents("abc")).toBeNull();
	});

	test("cents render without trailing zeros", () => {
		expect(centsToDollars(5_000)).toBe("50");
		expect(centsToDollars(1_234)).toBe("12.34");
	});
});

describe("expiry", () => {
	test("a local value round-trips through ISO", () => {
		const iso = localToIso("2026-03-01T18:00");
		expect(iso).not.toBeNull();
		expect(isoToLocal(iso)).toBe("2026-03-01T18:00");
	});

	test("empty and invalid input mean no expiry", () => {
		expect(localToIso("")).toBeNull();
		expect(localToIso("not a date")).toBeNull();
		expect(isoToLocal(null)).toBe("");
	});
});

describe("toCreateBody", () => {
	test("omits every empty limit instead of sending null", () => {
		const body = toCreateBody({ ...EMPTY_DRAFT, name: " ci " });
		expect(body).toEqual({ name: "ci", allowedModels: [] });
	});

	test("carries the limits that were filled in", () => {
		const body = toCreateBody({
			...EMPTY_DRAFT,
			name: "ci",
			allowedModels: ["general"],
			budget: "50",
			budgetReset: "monthly",
			rpm: "60",
		});
		expect(body).toEqual({
			name: "ci",
			allowedModels: ["general"],
			maxBudgetCents: 5_000,
			budgetReset: "monthly",
			rpm: 60,
		});
	});
});

describe("toUpdateBody", () => {
	test("an untouched draft sends nothing", () => {
		expect(toUpdateBody(draftFromKey(key), key)).toEqual({});
	});

	test("clearing a limit sends null, which is what clears it", () => {
		const draft = { ...draftFromKey(key), rpm: "", budget: "" };
		expect(toUpdateBody(draft, key)).toEqual({
			rpm: null,
			maxBudgetCents: null,
		});
	});

	test("reordering the allowed models counts as a change", () => {
		const draft = {
			...draftFromKey(key),
			allowedModels: ["fast", "general"],
		};
		expect(toUpdateBody(draft, key)).toEqual({
			allowedModels: ["fast", "general"],
		});
	});

	test("disabling travels on its own", () => {
		const draft = { ...draftFromKey(key), enabled: false };
		expect(toUpdateBody(draft, key)).toEqual({ enabled: false });
	});
});
