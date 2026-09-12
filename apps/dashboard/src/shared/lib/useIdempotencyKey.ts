"use client";

import { useCallback, useRef } from "react";

function freshKey(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto)
		return crypto.randomUUID();
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * One key per thing the operator is trying to create, not one per request.
 *
 * That distinction is the whole feature: a key regenerated on every submit would make a
 * double-clicked button look like two different intentions and create two resources, which is
 * exactly what the gateway's `Idempotency-Key` support exists to prevent. The key survives failed
 * attempts — a retry is the same intention — and is only rotated once something was actually
 * created, so the next one starts clean.
 */
export function useIdempotencyKey(): { key: () => string; rotate: () => void } {
	const current = useRef<string | null>(null);
	const key = useCallback(() => {
		current.current ??= freshKey();
		return current.current;
	}, []);
	const rotate = useCallback(() => {
		current.current = null;
	}, []);
	return { key, rotate };
}
