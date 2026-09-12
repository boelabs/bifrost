"use client";

import { ToastProvider, Toaster, useToastManager } from "#/components/ui/toast";
import { ApiError } from "#/shared/api/errors.ts";
import { useMemo, type ReactNode } from "react";

/**
 * Every mutation in this dashboard costs something on the other side — a key that now exists, a
 * deployment that no longer does. Silence after a click leaves the operator guessing whether the
 * table simply did not refresh, so results are announced rather than implied.
 */
export function NotificationProvider({ children }: { children: ReactNode }) {
	return (
		<ToastProvider limit={3} timeout={6000}>
			{children}
			<Toaster aria-label="Notifications" />
		</ToastProvider>
	);
}

export interface Notifier {
	success: (title: string, description?: string) => void;
	error: (title: string, description?: string) => void;
	info: (title: string, description?: string) => void;
}

export function useNotify(): Notifier {
	const manager = useToastManager();
	return useMemo<Notifier>(
		() => ({
			success: (title, description) =>
				manager.add({
					title,
					type: "success",
					...(description ? { description } : {}),
				}),
			error: (title, description) =>
				manager.add({
					title,
					type: "error",
					timeout: 10_000,
					...(description ? { description } : {}),
				}),
			info: (title, description) =>
				manager.add({ title, ...(description ? { description } : {}) }),
		}),
		[manager],
	);
}

/**
 * The gateway's public message when there is one. `ApiError` already carries it; anything else is an
 * unexpected failure and gets a generic sentence rather than a stack trace in a toast.
 */
export function describeError(cause: unknown, fallback: string): string {
	if (cause instanceof ApiError) return cause.message;
	if (cause instanceof Error && cause.message) return cause.message;
	return fallback;
}
