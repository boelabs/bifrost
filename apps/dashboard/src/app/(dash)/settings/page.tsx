import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { SettingsView } from "#/features/settings/SettingsView.tsx";
import { publicModelNames } from "#/features/deployments/api.ts";
import { Skeleton } from "#/shared/components/Skeleton.tsx";
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
				title="Settings"
				description="Router behaviour, fallback chains, and the response cache. These apply to every deployment."
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
			settings={settings}
			sessions={sessions}
			fallbacks={fallbacks}
			models={models}
		/>
	);
}

/** Four cards at the heights the real ones settle at: the router form, two chain lists, the cache. */
function SettingsSkeleton() {
	return (
		<div className="flex flex-col gap-6">
			{["24rem", "12.5rem", "12.5rem", "3rem"].map((height, index) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: placeholder cards have no identity
					key={index}
					className="rounded-[var(--ui-radius-surface)] border border-border/50 bg-card p-6"
				>
					<Skeleton className="h-5" width="8rem" />
					<Skeleton className="mt-2 h-3.5" width="24rem" />
					<Skeleton
						className="mt-5 rounded-[var(--ui-radius-surface)]"
						style={{ height }}
						width="100%"
					/>
				</div>
			))}
		</div>
	);
}
