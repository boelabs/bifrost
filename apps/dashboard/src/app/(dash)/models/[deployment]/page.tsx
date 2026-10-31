import { DeploymentHeaderActions } from "#/features/deployments/DeploymentHeaderActions.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { ButtonSkeleton } from "#/shared/components/Skeleton.tsx";
import { TextSkeleton } from "#/shared/components/TextSkeleton";
import { Breadcrumbs } from "#/shared/components/Breadcrumbs";
import { PageHeader } from "#/components/ui/page";
import { Status } from "#/components/ui/status";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
	DeploymentFormSkeleton,
	DeploymentForm,
} from "#/features/deployments/DeploymentForm.tsx";

import {
	listDeployments,
	adapterRegistry,
	getDeployment,
} from "#/features/deployments/api.ts";

/** One deployment's page: its identity and state up top, its editor below. */
export default function DeploymentPage(
	props: PageProps<"/models/[deployment]">,
) {
	return (
		<RouteBoundary title="The deployment could not be loaded">
			<Suspense fallback={<DeploymentPageSkeleton />}>
				<Deployment params={props.params} />
			</Suspense>
		</RouteBoundary>
	);
}

async function Deployment({
	params,
}: {
	params: PageProps<"/models/[deployment]">["params"];
}) {
	const { deployment: id } = await params;
	const [deployment, registry] = await Promise.all([
		getDeployment(id),
		adapterRegistry(),
	]);
	if (!deployment) {
		notFound();
	}
	// Only to say, when deleting, whether the model keeps routing; a failed read just says less.
	const siblings = await listDeployments({
		limit: 200,
		publicModel: deployment.publicModel,
		enabled: true,
	})
		.then((page) => page.data.filter((row) => row.id !== deployment.id).length)
		.catch(() => 1);
	return (
		<>
			<Breadcrumbs
				items={[
					{ label: "Models", href: "/models" },
					{ label: deployment.publicModel },
				]}
				recent={`${deployment.publicModel} · ${deployment.adapterKey}`}
			/>
			<PageHeader
				actions={
					<DeploymentHeaderActions
						deployment={deployment}
						siblings={siblings}
					/>
				}
				badge={
					<Status tone={deployment.enabled ? "success" : "neutral"}>
						{deployment.enabled ? "Enabled" : "Disabled"}
					</Status>
				}
				description={`${deployment.adapterKey} · ${deployment.upstreamModel}`}
				title={deployment.publicModel}
			/>
			<DeploymentForm
				adapters={registry.adapters}
				existing={deployment}
				key={`${deployment.id}:${deployment.updatedAt}`}
			/>
		</>
	);
}

function DeploymentPageSkeleton() {
	return (
		<>
			<Breadcrumbs
				items={[{ label: "Models", href: "/models" }, { label: "…" }]}
			/>
			<header className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex min-w-0 flex-col gap-1">
					<h1 className="font-semibold text-xl">
						<TextSkeleton length={18} />
					</h1>
					<p className="text-sm">
						<TextSkeleton length={32} />
					</p>
				</div>
				<div className="flex gap-2">
					<ButtonSkeleton label={6} size="md" />
					<ButtonSkeleton label={7} size="md" />
				</div>
			</header>
			<DeploymentFormSkeleton />
		</>
	);
}
