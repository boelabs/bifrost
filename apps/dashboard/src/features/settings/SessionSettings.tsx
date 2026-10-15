"use client";

import { type DashboardSettings, readNumbers } from "./common.ts";
import { FormSkeleton } from "#/shared/components/Skeleton";
import { saveDashboardSettingsAction } from "./actions.ts";
import { EmptyState } from "#/components/ui/page";
import { Input } from "#/components/ui/input";

import {
	SettingsCardSkeleton,
	type SettingsCopy,
	SettingsCard,
} from "./SettingsCard.tsx";

const FIELDS = [
	{
		key: "sessionTtlMinutes",
		label: "Session lifetime (min)",
		help: "A session is destroyed at this age no matter how active it has been.",
		min: 5,
		max: 43_200,
	},
	{
		key: "sessionIdleMinutes",
		label: "Idle window (min)",
		help: "A session unused for this long stops authenticating.",
		min: 1,
		max: 43_200,
	},
	{
		key: "loginMaxAttempts",
		label: "Failed logins allowed",
		help: "Counted per username and per client IP; both lock out together.",
		min: 1,
		max: 100,
	},
	{
		key: "loginLockoutMinutes",
		label: "Lockout (min)",
		help: "How long that lockout lasts.",
		min: 1,
		max: 1440,
	},
] as const;

const SESSIONS: SettingsCopy = {
	title: "Operator sessions",
	description:
		"How long a signed-in operator stays signed in, and what happens after repeated failed logins.",
	note: "Applies to everyone, including you, within seconds.",
};

function SessionFields({ settings }: { settings: DashboardSettings | null }) {
	return (
		<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
			{FIELDS.map((field) => (
				<Input
					defaultValue={settings ? String(settings[field.key]) : ""}
					description={field.help}
					key={field.key}
					label={field.label}
					max={field.max}
					min={field.min}
					name={field.key}
					type="number"
				/>
			))}
		</div>
	);
}

/**
 * Operator-session policy, which used to be four environment variables on the gateway.
 *
 * Owner-only, and the gateway enforces that: `users:manage` on `/admin/dashboard-settings` both
 * reads and writes it. Null when the operator's role cannot read it.
 */
export function SessionSettings({
	settings,
}: {
	settings: DashboardSettings | null;
}) {
	if (!settings) {
		return (
			<EmptyState
				description="Only owners can see and change how operator sessions work."
				title="Session policy is owner-only"
			/>
		);
	}
	return (
		<SettingsCard
			copy={SESSIONS}
			editable
			onSave={(form) =>
				saveDashboardSettingsAction(
					readNumbers(
						form,
						FIELDS.map((field) => field.key),
					),
				)
			}
			success="Session policy saved"
		>
			<SessionFields settings={settings} />
		</SettingsCard>
	);
}

export function SessionSettingsSkeleton() {
	return (
		<div aria-busy="true" aria-label="Loading sessions" role="status">
			<SettingsCardSkeleton copy={SESSIONS}>
				<FormSkeleton>
					<SessionFields settings={null} />
				</FormSkeleton>
			</SettingsCardSkeleton>
		</div>
	);
}
