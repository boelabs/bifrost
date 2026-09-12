import type { CreateKeyInput, UpdateKeyInput, VirtualKey } from "./common.ts";

/**
 * The form's shape, which is not the API's shape.
 *
 * Budgets travel as integer cents and limits as nullable integers, but an operator types dollars and
 * leaves boxes empty. Keeping every field a string here means the form has exactly one representation
 * of "nothing entered" — the empty string — instead of juggling null, undefined and NaN in the JSX.
 */
export interface KeyDraft {
	name: string;
	allowedModels: string[];
	/** Dollars, as typed. */
	budget: string;
	budgetReset: "" | NonNullable<VirtualKey["budgetReset"]>;
	rpm: string;
	tpm: string;
	/** `datetime-local` value, in the operator's own timezone. */
	expiresAt: string;
	enabled: boolean;
}

export const EMPTY_DRAFT: KeyDraft = {
	name: "",
	allowedModels: [],
	budget: "",
	budgetReset: "",
	rpm: "",
	tpm: "",
	expiresAt: "",
	enabled: true,
};

export function draftFromKey(key: VirtualKey): KeyDraft {
	return {
		name: key.name,
		allowedModels: [...key.allowedModels],
		budget: centsToDollars(key.maxBudgetCents),
		budgetReset: key.budgetReset ?? "",
		rpm: key.rpm === null ? "" : String(key.rpm),
		tpm: key.tpm === null ? "" : String(key.tpm),
		expiresAt: isoToLocal(key.expiresAt),
		enabled: key.enabled,
	};
}

/** `"12.5"` → `1250`. Empty is "no budget", which is a real, different setting from zero. */
export function dollarsToCents(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return Math.round(parsed * 100);
}

export function centsToDollars(cents: number | null): string {
	if (cents === null) return "";
	return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function toInteger(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return Math.trunc(parsed);
}

/**
 * `datetime-local` has no timezone, so the browser's is the only sensible reading: an operator typing
 * "18:00" means six in their own evening, not in UTC.
 */
export function localToIso(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	const parsed = new Date(trimmed);
	if (Number.isNaN(parsed.getTime())) return null;
	return parsed.toISOString();
}

export function isoToLocal(iso: string | null): string {
	if (!iso) return "";
	const parsed = new Date(iso);
	if (Number.isNaN(parsed.getTime())) return "";
	const offset = parsed.getTimezoneOffset() * 60_000;
	return new Date(parsed.getTime() - offset).toISOString().slice(0, 16);
}

export function toCreateBody(draft: KeyDraft): CreateKeyInput {
	const budget = dollarsToCents(draft.budget);
	const rpm = toInteger(draft.rpm);
	const tpm = toInteger(draft.tpm);
	const expiresAt = localToIso(draft.expiresAt);
	return {
		name: draft.name.trim(),
		allowedModels: draft.allowedModels,
		...(budget === null ? {} : { maxBudgetCents: budget }),
		...(draft.budgetReset === "" ? {} : { budgetReset: draft.budgetReset }),
		...(rpm === null ? {} : { rpm }),
		...(tpm === null ? {} : { tpm }),
		...(expiresAt === null ? {} : { expiresAt }),
	};
}

/**
 * Only what actually changed.
 *
 * The gateway reads `null` as "clear this limit" and an absent field as "leave it alone", so sending
 * the whole draft back would rewrite columns the operator never touched — and `resetSpend` in
 * particular must never ride along with an unrelated rename.
 */
export function toUpdateBody(
	draft: KeyDraft,
	original: VirtualKey,
): UpdateKeyInput {
	const body: UpdateKeyInput = {};
	const name = draft.name.trim();
	if (name !== original.name) body.name = name;

	const models = draft.allowedModels;
	const sameModels =
		models.length === original.allowedModels.length &&
		models.every((model, index) => model === original.allowedModels[index]);
	if (!sameModels) body.allowedModels = models;

	const budget = dollarsToCents(draft.budget);
	if (budget !== original.maxBudgetCents) body.maxBudgetCents = budget;

	const reset = draft.budgetReset === "" ? null : draft.budgetReset;
	if (reset !== original.budgetReset) body.budgetReset = reset;

	const rpm = toInteger(draft.rpm);
	if (rpm !== original.rpm) body.rpm = rpm;

	const tpm = toInteger(draft.tpm);
	if (tpm !== original.tpm) body.tpm = tpm;

	const expiresAt = localToIso(draft.expiresAt);
	const originalExpiry = original.expiresAt
		? new Date(original.expiresAt).toISOString()
		: null;
	if (expiresAt !== originalExpiry) body.expiresAt = expiresAt;

	if (draft.enabled !== original.enabled) body.enabled = draft.enabled;
	return body;
}
