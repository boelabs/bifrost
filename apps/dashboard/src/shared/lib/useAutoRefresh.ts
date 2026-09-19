"use client";

import { useEffect } from "react";

/**
 * A page that watches live traffic and only updates when someone presses a button is a screenshot.
 *
 * The interval calls the same `refresh` the button does, so nothing about the data path changes.
 * Whether a page ticks at all is the page's decision, not the operator's: the switch that used to
 * offer it defaulted to on, sat next to the button that does the same thing by hand, and gave an
 * operator one more control to reason about on the screen they leave open precisely so they do not
 * have to. The tables that an operator reads a row in — logs, audit — simply do not ask for it.
 */
export function useAutoRefresh(
	refresh: () => void,
	enabled: boolean,
	intervalMs = 30_000,
): void {
	useEffect(() => {
		if (!enabled) {
			return;
		}
		const id = setInterval(() => {
			// A hidden tab refreshing every 30s is cost with nobody watching it.
			if (document.hidden) {
				return;
			}
			refresh();
		}, intervalMs);
		return () => clearInterval(id);
	}, [enabled, intervalMs, refresh]);
}
