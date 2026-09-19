import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { runtimeTone } from "#/features/extensions/common.ts";
import { Skeleton } from "#/shared/components/Skeleton.tsx";
import { PageHeader } from "#/components/ui/page";
import { Status } from "#/components/ui/status";
import { Suspense } from "react";

import {
	ExtensionsProvider,
	UploadCodeButton,
	ExtensionsView,
} from "#/features/extensions/ExtensionsView.tsx";

import {
	listArtifacts,
	listInstances,
	runtimeStatus,
} from "#/features/extensions/api.ts";

/**
 * Code that runs inside the request path.
 *
 * The runtime badge and the instances table both read the live runtime, from different boundaries;
 * `runtimeStatus` is memoised per request (React's `cache`), so that stays one call to the gateway.
 */
export default function ExtensionsPage() {
	return (
		<ExtensionsProvider>
			<PageHeader
				description="Code that runs inside the request path — the gateway's equivalent of a logging or policy callback, except it can also change the request."
				title="Extensions"
			>
				<div className="flex items-center gap-2">
					<Suspense
						fallback={<Skeleton className="h-7 rounded-full" width="7.5rem" />}
					>
						<RuntimeBadge />
					</Suspense>
					<UploadCodeButton />
				</div>
			</PageHeader>

			<RouteBoundary title="Extensions could not be loaded">
				<Suspense fallback={<ExtensionsSkeleton />}>
					<Runtime />
				</Suspense>
			</RouteBoundary>
		</ExtensionsProvider>
	);
}

async function RuntimeBadge() {
	const status = await runtimeStatus();
	return (
		<Status tone={runtimeTone(status.status)}>runtime {status.status}</Status>
	);
}

async function Runtime() {
	const [status, artifacts, instances] = await Promise.all([
		runtimeStatus(),
		listArtifacts(),
		listInstances(),
	]);
	return (
		<ExtensionsView
			artifacts={artifacts}
			instances={instances}
			status={status}
		/>
	);
}

/** The two cards — instances, then code — at the heights the real ones settle at. */
function ExtensionsSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			{["15.5rem", "13.5rem"].map((height, index) => (
				<div
					className="rounded-[var(--ui-radius-surface)] border border-border/50 bg-card p-6"
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholder cards have no identity
					key={index}
				>
					<div className="flex flex-wrap items-start justify-between gap-3 pb-4">
						<div>
							<Skeleton className="h-5" width="7rem" />
							<Skeleton className="mt-2 h-3.5" width="30rem" />
						</div>
						<Skeleton
							className="h-10 rounded-[var(--ui-radius-control)]"
							width="8rem"
						/>
					</div>
					<Skeleton
						className="rounded-[var(--ui-radius-surface)]"
						style={{ height }}
						width="100%"
					/>
				</div>
			))}
		</div>
	);
}
