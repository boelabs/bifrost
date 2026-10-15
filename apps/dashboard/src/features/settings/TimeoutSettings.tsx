"use client";

import { FormSkeleton } from "#/shared/components/Skeleton";
import { useSession } from "#/features/auth/session.tsx";
import { saveRouterSettingsAction } from "./actions.ts";
import type { RouterSettings } from "./common.ts";

import {
	SettingsCardSkeleton,
	type SettingsCopy,
	SettingsCard,
} from "./SettingsCard.tsx";

import {
	ExecutionPoliciesEditor,
	readExecutionPolicies,
} from "./ExecutionPolicies.tsx";

const DEADLINES: SettingsCopy = {
	title: "Deadlines",
	description:
		"In seconds, measured on the connection like an HTTP client, never on the model's output. Response: until the answer (JSON) or its headers (stream) arrive. Idle: the longest silence between stream bytes; empty means no limit. Total: the whole request, retries included.",
	note: "Applies to every deployment.",
};

/** How long the gateway waits on an upstream, per call type and mode, saved as one policy. */
export function TimeoutSettings({
	settings,
}: {
	settings: RouterSettings | null;
}) {
	const { can } = useSession();
	const editable = can("settings:write");
	return (
		<SettingsCard
			copy={DEADLINES}
			editable={editable}
			onSave={(form) =>
				saveRouterSettingsAction({
					executionPolicies: readExecutionPolicies(form),
				})
			}
			success="Deadlines saved"
		>
			<ExecutionPoliciesEditor
				editable={editable}
				policies={settings?.executionPolicies}
			/>
		</SettingsCard>
	);
}

export function TimeoutSettingsSkeleton() {
	return (
		<div aria-busy="true" aria-label="Loading timeouts" role="status">
			<SettingsCardSkeleton copy={DEADLINES}>
				<FormSkeleton>
					<ExecutionPoliciesEditor editable policies={undefined} />
				</FormSkeleton>
			</SettingsCardSkeleton>
		</div>
	);
}
