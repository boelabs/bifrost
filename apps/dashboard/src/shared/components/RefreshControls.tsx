"use client";

import { useAutoRefresh } from "#/shared/lib/useAutoRefresh.ts";
import { useRefresh } from "#/shared/lib/useRefresh.ts";
import { IconRefresh } from "@tabler/icons-react";
import { Button } from "#/components/ui/button";

/**
 * The Refresh button, and — where a page is worth leaving open on a second screen — the interval
 * that presses it every thirty seconds on its own.
 */
export function RefreshControls({
	auto = false,
	label = "Refresh",
}: {
	/** Whether this page refreshes itself. A property of the page, not of the operator. */
	auto?: boolean;
	label?: string;
}) {
	const { refresh, pending } = useRefresh();
	useAutoRefresh(refresh, auto);
	const text = pending ? "Refreshing…" : label;
	return (
		<Button disabled={pending} onClick={refresh} size="sm" variant="secondary">
			<IconRefresh aria-hidden className="size-4" />
			{text}
		</Button>
	);
}
