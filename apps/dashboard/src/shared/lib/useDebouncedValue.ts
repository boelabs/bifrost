"use client";

import { useEffect, useState } from "react";

/**
 * `value` once it stopped changing for `delayMs`: a search asks the gateway when the operator
 * pauses, not on every key.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [settled, setSettled] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return settled;
}
