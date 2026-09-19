"use client";

import { EmptyState } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { useEffect } from "react";

/**
 * The last boundary inside the authenticated area.
 *
 * Each page already wraps its own data in a `RouteBoundary`, so a failing admin call keeps the shell
 * and the navigation. This catches the one failure that cannot: resolving the operator's identity,
 * which the shell itself depends on. Without it the dashboard answers a gateway it cannot reach with
 * Next's bare "a server error occurred" page — no theme, no navigation, and nothing to press.
 *
 * The message is written here rather than taken from `error`: production builds replace a server
 * error's message with a generic one, so echoing it would only ever say "an error occurred".
 */
export default function AuthedError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("The dashboard shell failed to render", error);
	}, [error]);

	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-surface px-4">
			<EmptyState
				description="Most often this means the gateway is not reachable from this process — check that it is running and that GATEWAY_URL points at it. Signing in again helps if the session simply expired."
				title="The dashboard could not start"
			/>
			<div className="flex flex-wrap items-center justify-center gap-3">
				<Button onClick={reset} variant="secondary">
					Try again
				</Button>
				<Button nativeButton={false} render={<a href="/auth" />}>
					Sign in again
				</Button>
			</div>
			{error.digest ? (
				<p className="text-fg-muted text-xs">Reference {error.digest}</p>
			) : null}
		</div>
	);
}
