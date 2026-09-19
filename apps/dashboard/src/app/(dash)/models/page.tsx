import { ModelsSkeleton } from "#/features/deployments/ModelsSkeleton.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { PageHeader } from "#/components/ui/page";
import { Suspense } from "react";

import {
	NewDeploymentButton,
	ModelsProvider,
	ModelsView,
} from "#/features/deployments/ModelsView.tsx";

import {
	adapterRegistry,
	listDeployments,
} from "#/features/deployments/api.ts";

/**
 * Public models and the deployments behind them.
 *
 * The adapter registry is only needed by the dialog, so it is started here and handed to the
 * provider unawaited — nothing on the page waits for it. The deployments are the page's subject and
 * stream into cards that already have their frame and their table headers.
 */
export default function ModelsPage() {
	return (
		<ModelsProvider adapters={adapters()}>
			<PageHeader
				description="A public model is the name clients send, and every deployment sharing that name forms its routing pool. Models are not rows — one exists while at least one deployment carries its name."
				title="Models"
			>
				<NewDeploymentButton />
			</PageHeader>

			<RouteBoundary title="Models could not be loaded">
				<Suspense fallback={<ModelsSkeleton />}>
					<Deployments />
				</Suspense>
			</RouteBoundary>
		</ModelsProvider>
	);
}

async function adapters() {
	return (await adapterRegistry()).adapters;
}

async function Deployments() {
	const page = await listDeployments({ limit: 200 });
	return <ModelsView deployments={page.data} />;
}
