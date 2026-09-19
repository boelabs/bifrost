"use client";

import { saveDashboardSettingsAction } from "./actions.ts";
import type { DashboardSettings } from "./common.ts";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Form } from "#/components/ui/form";
import { useState } from "react";

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

/**
 * Operator-session policy, which used to be four environment variables on the gateway.
 *
 * Owner-only, and the gateway enforces that — this form is hidden without the permission, but it is
 * `users:manage` on `/admin/dashboard-settings` that actually decides.
 */
export function SessionForm({
	settings,
	editable,
	onSaved,
}: {
	settings: DashboardSettings;
	editable: boolean;
	onSaved: () => Promise<void> | void;
}) {
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [saved, setSaved] = useState(false);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setSaved(false);
		setPending(true);
		const form = new FormData(event.currentTarget);
		const result = await saveDashboardSettingsAction(
			Object.fromEntries(
				FIELDS.map((field) => [field.key, Number(form.get(field.key))]),
			),
		);
		setPending(false);
		if (!result.ok) {
			setError(result.message);
			return;
		}
		setSaved(true);
		await onSaved();
	}

	return (
		<Form className="flex flex-col gap-6" onSubmit={onSubmit}>
			<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
				{FIELDS.map((field) => (
					<Input
						defaultValue={String(settings[field.key])}
						description={field.help}
						disabled={!editable}
						key={field.key}
						label={field.label}
						max={field.max}
						min={field.min}
						name={field.key}
						type="number"
					/>
				))}
			</div>

			{error ? <ErrorNote>{error}</ErrorNote> : null}

			{editable ? (
				<div className="flex items-center justify-end gap-3">
					{saved ? <span className="text-fg-muted text-sm">Saved.</span> : null}
					<Button disabled={pending} type="submit">
						{pending ? "Saving…" : "Save session policy"}
					</Button>
				</div>
			) : null}
		</Form>
	);
}
