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

/**
 * The header and the composer, where the real ones sit.
 *
 * The playground arrives empty, and an empty `ChatSession` centres its composer in the remaining
 * space with the "Playground" heading above it (below `sm` it stays at the bottom, with the heading
 * in the transcript instead). So the placeholder copies that layout — and `PageHeader`'s own
 * `items-start` / `mt-1` rhythm — rather than a bottom bar and a pair of header controls the page
 * does not have.
 */
function PlaygroundSkeleton() {
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex flex-wrap items-start justify-between gap-4 pb-7">
				<div>
					<Skeleton className="h-9" width="10rem" />
					<Skeleton className="mt-1.5 h-5" width="22rem" />
				</div>
			</div>
			<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
				<div className="min-h-0 flex-1 overflow-hidden pt-6">
					<div className="flex h-full items-center justify-center px-4 pb-8 sm:hidden">
						<Skeleton className="h-8" width="9rem" />
					</div>
				</div>
				<div className="relative mx-auto w-full shrink-0 px-2 pt-3 pb-2 sm:absolute sm:top-1/2 sm:left-1/2 sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:px-0 sm:pb-4 xl:max-w-3xl">
					<div className="mb-6 hidden justify-center sm:flex">
						<Skeleton className="h-9" width="10rem" />
					</div>
					<Skeleton className="h-13 rounded-[28px]" />
				</div>
			</div>
		</div>
	);
}
