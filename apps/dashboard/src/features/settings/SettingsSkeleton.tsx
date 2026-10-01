"use client";

import { TextSkeleton } from "#/shared/components/TextSkeleton";
import { ContentPanel } from "#/components/ui/card";
import { SessionForm } from "./SessionForm";
import { FALLBACK_KINDS } from "./common";
import { RouterForm } from "./RouterForm";

import {
	ButtonSkeleton,
	TableSkeleton,
	FormSkeleton,
} from "#/shared/components/Skeleton";

const nothingSaved = () => undefined;

export function SettingsSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading settings"
			className="flex flex-col gap-6"
			role="status"
		>
			<ContentPanel className="flex flex-col gap-6">
				<div className="flex flex-col gap-1">
					<h2 className="font-semibold">
						<TextSkeleton length={6} />
					</h2>
					<p className="text-muted-foreground text-sm">
						<TextSkeleton length={78} />
					</p>
				</div>
				<FormSkeleton>
					<RouterForm editable onSaved={nothingSaved} settings={null} />
				</FormSkeleton>
				<p className="border-t pt-4 text-muted-foreground text-xs">
					<TextSkeleton length={180} />
				</p>
			</ContentPanel>
			<ContentPanel className="flex flex-col gap-6">
				<div className="flex flex-col gap-1">
					<h2 className="font-semibold">
						<TextSkeleton length={17} />
					</h2>
					<p className="text-muted-foreground text-sm">
						<TextSkeleton length={125} />
					</p>
				</div>
				<FormSkeleton>
					<SessionForm
						editable
						onSaved={nothingSaved}
						settings={{
							sessionTtlMinutes: 60,
							sessionIdleMinutes: 30,
							loginMaxAttempts: 5,
							loginLockoutMinutes: 15,
							updatedAt: "",
						}}
					/>
				</FormSkeleton>
			</ContentPanel>
			{FALLBACK_KINDS.map(({ reason, title, description }) => (
				<ContentPanel key={reason}>
					<div className="flex flex-wrap items-start justify-between gap-3 pb-4">
						<div>
							<h2 className="font-semibold">
								<TextSkeleton length={title.length} />
							</h2>
							<p className="max-w-2xl pt-1 text-muted-foreground text-sm">
								<TextSkeleton length={description.length} />
							</p>
						</div>
						<ButtonSkeleton label={9} />
					</div>
					<TableSkeleton
						headers={["Primary model", "Chain", ""]}
						pagination
						plain
						rows={3}
					/>
				</ContentPanel>
			))}
			<ContentPanel className="flex flex-wrap items-center justify-between gap-4">
				<div>
					<h2 className="font-semibold">
						<TextSkeleton length={14} />
					</h2>
					<p className="pt-1 text-muted-foreground text-sm">
						<TextSkeleton length={45} />
					</p>
				</div>
				<ButtonSkeleton label={11} size="md" />
			</ContentPanel>
		</div>
	);
}
