import { SessionSettings } from "#/features/settings/SessionSettings.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { dashboardSettings } from "#/features/settings/api.ts";
import { ApiError } from "#/shared/api/errors.ts";

/** Operator-session policy: lifetime, idle window and login lockout. */
export default function SessionSettingsPage() {
	return (
		<RouteBoundary title="The session policy could not be loaded">
			<Sessions />
		</RouteBoundary>
	);
}

async function Sessions() {
	// Owner-only on the gateway. Another role gets a 403, which is not a page failure — it is the
	// answer, and the section says so.
	const settings = await dashboardSettings().catch((cause: unknown) => {
		if (cause instanceof ApiError && cause.status === 403) {
			return null;
		}
		throw cause;
	});
	return <SessionSettings settings={settings} />;
}
