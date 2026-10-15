import { LogDetailSkeleton } from "#/features/observability/LogDetailSkeleton.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { LogDetail } from "#/features/observability/LogDetail.tsx";
import { isOperationId } from "#/features/observability/trace.ts";
import { operationDetail } from "#/features/observability/api.ts";
import { ApiError } from "#/shared/api/errors.ts";
import { notFound } from "next/navigation";
import { Suspense } from "react";

type Params = PageProps<"/logs/[id]">["params"];

/**
 * One operation, on a page of its own: what the caller received, every upstream attempt, and the
 * retained payload behind its own audited click.
 *
 * The operation is read here, on the server; only the payload, which costs an access record, is
 * left for the operator to ask for.
 */
export default function LogPage(props: PageProps<"/logs/[id]">) {
	return (
		<RouteBoundary title="The operation could not be loaded">
			<Suspense fallback={<LogDetailSkeleton />}>
				<Operation params={props.params} />
			</Suspense>
		</RouteBoundary>
	);
}

async function Operation({ params }: { params: Params }) {
	const { id } = await params;
	if (!isOperationId(id)) {
		notFound();
	}
	return <LogDetail detail={await load(id)} />;
}

async function load(id: string) {
	try {
		return await operationDetail(id);
	} catch (cause) {
		// Retention sweeps operations away, so an old link reaching nothing is expected, not a failure.
		if (cause instanceof ApiError && cause.status === 404) {
			notFound();
		}
		throw cause;
	}
}
