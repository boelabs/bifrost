import { PageHeader } from "#/components/ui/page";
import { Suspense } from "react";

import {
	SettingsNavFallback,
	SettingsNav,
} from "#/features/settings/SettingsNav.tsx";

/** Settings: its sections beside the one open, which fills the rest. */
export default function SettingsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<>
			<PageHeader title="Settings" />
			<div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
				<Suspense fallback={<SettingsNavFallback />}>
					<SettingsNav />
				</Suspense>
				<div className="flex min-w-0 flex-col gap-6">{children}</div>
			</div>
		</>
	);
}
