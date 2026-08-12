import type { VirtualKeyAuth } from "#auth/types.ts";

/** Seconds of the budget reset period. 0 = no expiration (never resets). */
export function periodSeconds(reset: VirtualKeyAuth["budgetReset"]): number {
	switch (reset) {
		case "hourly":
			return 3600;
		case "daily":
			return 86_400;
		case "weekly":
			return 604_800;
		case "monthly":
			return 2_592_000;
		default:
			return 0;
	}
}

export function nextResetAt(
	reset: VirtualKeyAuth["budgetReset"],
	from = new Date(),
): Date | null {
	const seconds = periodSeconds(reset);
	if (seconds <= 0) return null;
	return new Date(from.getTime() + seconds * 1000);
}

export function secondsUntilReset(
	key: Pick<VirtualKeyAuth, "budgetReset" | "budgetResetAt">,
): number {
	if (!key.budgetReset) return 0;
	if (!key.budgetResetAt) return periodSeconds(key.budgetReset);
	const remaining = Math.ceil(
		(new Date(key.budgetResetAt).getTime() - Date.now()) / 1000,
	);
	return Math.max(1, remaining);
}
