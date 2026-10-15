import { RoutingSettings } from "#/features/settings/RoutingSettings.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { routerSettings } from "#/features/settings/api.ts";

/** How a request picks a deployment, and how failures take one out of rotation. */
export default function RoutingSettingsPage() {
	return (
		<RouteBoundary title="Routing settings could not be loaded">
			<Routing />
		</RouteBoundary>
	);
}

async function Routing() {
	return <RoutingSettings settings={await routerSettings()} />;
}
