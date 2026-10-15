"use client";

import { useNotify } from "#/shared/feedback/notifications.tsx";
import { ButtonSkeleton } from "#/shared/components/Skeleton";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { useSession } from "#/features/auth/session.tsx";
import { useMutation } from "#/shared/lib/mutation.ts";
import { Button } from "#/components/ui/button";
import { clearCacheAction } from "./actions.ts";
import { useState } from "react";

import {
	SettingsCardSkeleton,
	type SettingsCopy,
	SettingsFrame,
} from "./SettingsCard.tsx";

const CACHE: SettingsCopy = {
	title: "Response cache",
	description:
		"Drops every cached response across the fleet. The next request for each of them is paid for upstream again.",
	note: "Takes effect at once.",
};

const entries = (count: number) =>
	`${count} cached ${count === 1 ? "entry" : "entries"}`;

/** The response cache has nothing to configure here, only an action: clearing it. */
export function CacheSettings() {
	const { can } = useSession();
	const confirm = useConfirm();
	const notify = useNotify();
	const { pending, run } = useMutation();
	const [cleared, setCleared] = useState<number | null>(null);

	async function clear() {
		const confirmed = await confirm({
			title: "Clear every cached response?",
			description:
				"Cached answers are dropped across the fleet, so the next request for each of them is paid for upstream again.",
			confirmLabel: "Clear cache",
		});
		if (!confirmed) {
			return;
		}
		const result = await run(() => clearCacheAction(), {
			failure: "The cache could not be cleared.",
		});
		if (result.ok) {
			setCleared(result.data.deleted);
			notify.success(`Removed ${entries(result.data.deleted)}`);
		}
	}

	if (!can("settings:write")) {
		return (
			<SettingsFrame
				description={CACHE.description}
				note="Your role cannot clear the cache."
				title={CACHE.title}
			/>
		);
	}
	return (
		<SettingsFrame
			action={
				<Button
					loading={pending}
					onClick={() => void clear()}
					size="sm"
					variant="secondary"
				>
					Clear cache
				</Button>
			}
			description={CACHE.description}
			note={cleared === null ? CACHE.note : `Removed ${entries(cleared)}.`}
			title={CACHE.title}
		/>
	);
}

export function CacheSettingsSkeleton() {
	return (
		<div aria-busy="true" aria-label="Loading cache" role="status">
			<SettingsCardSkeleton
				action={<ButtonSkeleton label={11} size="sm" />}
				copy={CACHE}
			/>
		</div>
	);
}
