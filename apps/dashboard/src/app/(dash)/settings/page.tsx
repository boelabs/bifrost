import { SettingsSkeleton } from "#/features/settings/SettingsSkeleton";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { SettingsView } from "#/features/settings/SettingsView.tsx";
import { publicModelNames } from "#/features/deployments/api.ts";
import { PageHeader } from "#/components/ui/page";
import { Suspense } from "react";

import {
	dashboardSettings,
	routerSettings,
	listFallbacks,
} from "#/features/settings/api.ts";

export default function SettingsPage() {
	return (
		<>
			<PageHeader
				description="Router behaviour, fallback chains, and the response cache. These apply to every deployment."
				title="Settings"
			/>
			<RouteBoundary title="Settings could not be loaded">
				<Suspense fallback={<SettingsSkeleton />}>
					<Configuration />
				</Suspense>
			</RouteBoundary>
		</>
	);
}

async function Configuration() {
	const [settings, fallbacks, models, sessions] = await Promise.all([
		routerSettings(),
		listFallbacks(),
		// Only to suggest names in the chain editor; a role without deployment reads still works.
		publicModelNames(),
		// Owner-only on the gateway. An admin gets a 403, which is not a page failure — it is the
		// answer, and the card is simply not rendered.
		dashboardSettings().catch(() => null),
	]);
	return (
		<SettingsView
			fallbacks={fallbacks}
			models={models}
			sessions={sessions}
			settings={settings}
		/>
	);
}
