import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { adapterRegistry } from "#/features/deployments/api.ts";
import { Breadcrumbs } from "#/shared/components/Breadcrumbs";
import { PageHeader } from "#/components/ui/page";
import { Suspense } from "react";

import {
	DeploymentFormSkeleton,
	DeploymentForm,
} from "#/features/deployments/DeploymentForm.tsx";

/** A new deployment: a public model connected to a provider, edited on its own page. */
export default function NewDeploymentPage() {
	return (
		<>
			<Breadcrumbs
				items={[{ label: "Models", href: "/models" }, { label: "New" }]}
			/>
			<PageHeader
				description="Connect a public model to a provider."
				title="New deployment"
			/>
			<RouteBoundary title="The adapters could not be loaded">
				<Suspense fallback={<DeploymentFormSkeleton />}>
					<Editor />
				</Suspense>
			</RouteBoundary>
		</>
	);
}

async function Editor() {
	const { adapters } = await adapterRegistry();
	return <DeploymentForm adapters={adapters} />;
}
