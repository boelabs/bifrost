"use client";

import { useAutoRefresh } from "#/shared/lib/useAutoRefresh.ts";
import { useRefresh } from "#/shared/lib/useRefresh.ts";
import { IconRefresh } from "@tabler/icons-react";
import { Button } from "#/components/ui/button";
import { Switch } from "#/components/ui/switch";

/**
 * The Refresh button, and — where a page is worth leaving open on a second screen — the switch that
 * presses it every thirty seconds.
 */
export function RefreshControls({
	auto,
	label = "Refresh",
}: {
	/** Present to offer auto-refresh at all; its value is the initial state. */
	auto?: boolean;
	label?: string;
}) {
	const { refresh, pending } = useRefresh();
	const { enabled, setEnabled } = useAutoRefresh(refresh, auto ?? false);
	return (
		<>
			{auto === undefined ? null : (
				<Switch checked={enabled} onCheckedChange={setEnabled}>
					<span className="text-fg-muted text-xs">Auto</span>
				</Switch>
			)}
			<Button
				variant="secondary"
				size="sm"
				disabled={pending}
				onClick={refresh}
			>
				<IconRefresh aria-hidden className="size-4" />
				{pending ? "Refreshing…" : label}
			</Button>
		</>
	);
}
