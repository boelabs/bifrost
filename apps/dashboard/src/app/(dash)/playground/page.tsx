import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { listPublicModels } from "#/features/playground/catalog.ts";
import { Playground } from "#/features/playground/Playground.tsx";
import { Skeleton } from "#/shared/components/Skeleton.tsx";
import { connection } from "next/server";
import { Suspense } from "react";

/**
 * The playground.
 *
 * Its own shell — the header, the model picker frame and the composer — is client-rendered and needs
 * no server round trip, so a navigation here is instant on arrival. Inference itself never goes
 * through this process: the page streams straight from the browser to the gateway's `/v1` endpoints
 * with the operator's session cookie (see `features/playground/api.ts`), which is what keeps tokens
 * arriving as fast as the upstream produces them.
 */
export default function PlaygroundPage() {
	return (
		<RouteBoundary title="The playground could not be loaded">
			<Suspense fallback={<PlaygroundSkeleton />}>
				<Session />
			</Suspense>
		</RouteBoundary>
	);
}

async function Session() {
	// The catalog is cached, but it must not be fetched while *building* — the image is built with no
	// gateway to reach. `connection()` moves the first fetch to the first real request, after which
	// `listPublicModels` serves it from the cache.
	await connection();
	return <Playground models={await listPublicModels()} />;
}

/** The header and the composer, at the size the real ones occupy. */
function PlaygroundSkeleton() {
	return (
		<div className="flex h-full flex-col">
			<div className="flex flex-wrap items-center justify-between gap-4 pb-6">
				<div>
					<Skeleton className="h-8" width="10rem" />
					<Skeleton className="mt-2 h-3.5" width="26rem" />
				</div>
				<div className="flex items-center gap-2">
					<Skeleton
						className="h-8 rounded-[var(--ui-radius-control)]"
						width="14rem"
					/>
					<Skeleton
						className="h-8 rounded-[var(--ui-radius-control)]"
						width="8rem"
					/>
				</div>
			</div>
			<div className="mt-auto">
				<Skeleton className="rounded-[28px]" style={{ height: "7rem" }} />
			</div>
		</div>
	);
}
