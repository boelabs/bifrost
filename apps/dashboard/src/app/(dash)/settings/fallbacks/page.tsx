import { FallbackSettings } from "#/features/settings/FallbackSettings.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { publicModelNames } from "#/features/deployments/api.ts";
import { listFallbacks } from "#/features/settings/api.ts";

/** The chains a failing request moves along, one list per case. */
export default function FallbackSettingsPage() {
	return (
		<RouteBoundary title="Fallback chains could not be loaded">
			<Fallbacks />
		</RouteBoundary>
	);
}

async function Fallbacks() {
	const [fallbacks, models] = await Promise.all([
		listFallbacks(),
		// Only to suggest names in the chain editor; a role without deployment reads still works.
		publicModelNames(),
	]);
	return <FallbackSettings fallbacks={fallbacks} models={models} />;
}
