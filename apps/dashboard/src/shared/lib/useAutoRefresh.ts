"use client";

import { useEffect, useState } from "react";

/**
 * A page that watches live traffic and only updates when someone presses a button is a screenshot.
 *
 * The interval calls the same `refresh` the button does, so nothing about the data path changes —
 * and it is a visible switch rather than a hidden behaviour, because an operator reading a row does
 * not want the table moving under them.
 */
export function useAutoRefresh(
	refresh: () => void,
	initiallyEnabled: boolean,
	intervalMs = 30_000,
): { enabled: boolean; setEnabled: (enabled: boolean) => void } {
	const [enabled, setEnabled] = useState(initiallyEnabled);

	useEffect(() => {
		if (!enabled) return;
		const id = setInterval(() => {
			// A hidden tab refreshing every 30s is cost with nobody watching it.
			if (document.hidden) return;
			refresh();
		}, intervalMs);
		return () => clearInterval(id);
	}, [enabled, intervalMs, refresh]);

	return { enabled, setEnabled };
}
