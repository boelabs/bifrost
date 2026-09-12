"use client";

import { catchError, type ErrorInfo } from "next/error";
import { EmptyState } from "#/components/ui/page";
import { Button } from "#/components/ui/button";

/**
 * What a page shows when the gateway call behind it throws.
 *
 * Without one, a single failing admin call takes the whole shell down and the operator loses the
 * navigation they would use to go somewhere that still works.
 *
 * `catchError` rather than a plain React error boundary for two reasons: it leaves `redirect()` and
 * `notFound()` alone — an expired session still redirects to the login screen instead of being
 * rendered as a failure — and its `retry()` re-runs the Server Components inside the boundary, so
 * "Retry" actually re-asks the gateway rather than just resetting client state.
 *
 *     <RouteBoundary title="Keys could not be loaded">
 *       <Suspense fallback={…}><Keys /></Suspense>
 *     </RouteBoundary>
 */
function RouteErrorFallback(
	{
		title,
		resetHref,
	}: {
		title: string;
		/** Where "Start over" goes, for pages whose own filters can produce the failure. */
		resetHref?: string;
	},
	{ error, retry }: ErrorInfo,
) {
	return (
		<>
			<EmptyState
				title={title}
				description={
					(error instanceof Error && error.message) || "Please try again."
				}
			/>
			<div className="flex justify-center gap-3 pt-4">
				<Button variant="secondary" onClick={() => retry()}>
					Retry
				</Button>
				{resetHref ? (
					<Button nativeButton={false} render={<a href={resetHref} />}>
						Reset filters
					</Button>
				) : null}
			</div>
		</>
	);
}

export const RouteBoundary = catchError(RouteErrorFallback);
