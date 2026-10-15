import { TimeoutSettings } from "#/features/settings/TimeoutSettings.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { routerSettings } from "#/features/settings/api.ts";

/** How long the gateway waits on an upstream, per call type. */
export default function TimeoutSettingsPage() {
	return (
		<RouteBoundary title="Timeouts could not be loaded">
			<Timeouts />
		</RouteBoundary>
	);
}

async function Timeouts() {
	return <TimeoutSettings settings={await routerSettings()} />;
}
