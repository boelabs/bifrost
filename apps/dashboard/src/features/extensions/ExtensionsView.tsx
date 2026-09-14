"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { type InstanceDraft, InstanceDialog } from "./InstanceDialog.tsx";
import { createContext, Suspense, use, useMemo, useState } from "react";
import { useMutation, useRowActions } from "#/shared/lib/mutation.ts";
import { useNotify } from "#/shared/feedback/notifications.tsx";
import { RowActions } from "#/shared/components/RowActions.tsx";
import { Can, useSession } from "#/features/auth/session.tsx";
import { Skeleton } from "#/shared/components/Skeleton.tsx";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { Card, CardContent } from "#/components/ui/card";
import { useRefresh } from "#/shared/lib/useRefresh.ts";
import { EmptyState } from "#/components/ui/page";
import { UploadDialog } from "./UploadDialog.tsx";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";

import {
	loadArtifactVersionsAction,
	activateArtifactAction,
	deleteArtifactAction,
	deleteInstanceAction,
	resetInstanceAction,
} from "./actions.ts";

import {
	IconVersions,
	IconRefresh,
	IconUpload,
	IconTrash,
	IconPlus,
	IconEdit,
} from "@tabler/icons-react";

import type {
	RuntimeInstance,
	RuntimeStatus,
	Artifact,
	Instance,
} from "./common.ts";

function instanceTone(
	status: string,
): "success" | "warning" | "danger" | "muted" {
	if (status === "active") return "success";
	if (status === "runtime_disabled") return "danger";
	if (status === "disabled") return "muted";
	return "warning";
}

/** `key: null` uploads a brand-new module; a key uploads another version of that one. */
type Uploading = { key: string | null } | null;

interface ExtensionsValue {
	upload: (key: string | null) => void;
}

const ExtensionsContext = createContext<ExtensionsValue | null>(null);

/**
 * The upload dialog, shared by the "Upload code" button in the page header and the per-module upload
 * button in the table further down — two `<Suspense>` boundaries, one dialog.
 */
export function ExtensionsProvider({
	children,
}: {
	children: React.ReactNode;
}) {
	const { refresh } = useRefresh();
	const notify = useNotify();
	const [uploading, setUploading] = useState<Uploading>(null);
	const value = useMemo<ExtensionsValue>(
		() => ({ upload: (key) => setUploading({ key }) }),
		[],
	);
	return (
		<ExtensionsContext value={value}>
			{children}
			<UploadDialog
				isOpen={uploading !== null}
				initialKey={uploading?.key ?? null}
				onClose={() => setUploading(null)}
				onSaved={() => {
					refresh();
					notify.success("Module uploaded and activated");
				}}
			/>
		</ExtensionsContext>
	);
}

function useExtensions(): ExtensionsValue {
	const value = use(ExtensionsContext);
	if (!value)
		throw new Error("useExtensions must be used inside ExtensionsProvider");
	return value;
}

/** The "Upload code" button, which lives up in the page header. */
function UploadCode() {
	const { upload } = useExtensions();
	return (
		<Can permissions={["settings:write"]}>
			<Button size="sm" onClick={() => upload(null)}>
				<IconUpload size={15} aria-hidden className="mr-2" />
				Upload code
			</Button>
		</Can>
	);
}

/**
 * Its own `<Suspense>` boundary: the button waits on the operator's permissions, and a `<Suspense>`
 * the page passes *into* `PageHeader` (a Client Component) does not count as one during prerendering.
 */
export function UploadCodeButton() {
	return (
		<Suspense
			fallback={
				<Skeleton
					className="h-8 rounded-[var(--ui-radius-control)]"
					width="7.5rem"
				/>
			}
		>
			<UploadCode />
		</Suspense>
	);
}

export function ExtensionsView({
	status,
	artifacts,
	instances,
}: {
	status: RuntimeStatus;
	artifacts: Artifact[];
	instances: Instance[];
}) {
	const { upload } = useExtensions();
	const { can } = useSession();
	const { refresh } = useRefresh();
	const confirm = useConfirm();
	const notify = useNotify();
	const { run } = useMutation();
	const { rows: artifactRows, act: actOnArtifact } = useRowActions(
		artifacts,
		(row) => row.key,
	);
	const { rows: instanceRows, act: actOnInstance } = useRowActions(
		instances,
		(row) => row.id,
	);
	const editable = can("settings:write");

	const [draft, setDraft] = useState<InstanceDraft | null>(null);
	const [versionsOf, setVersionsOf] = useState<string | null>(null);
	const [versions, setVersions] = useState<Artifact[]>([]);

	const definitions = artifactRows.map((artifact) => artifact.key);
	const runtimeById = new Map<string, RuntimeInstance>(
		status.instances.map((instance) => [instance.id, instance]),
	);

	async function openVersions(key: string) {
		if (versionsOf === key) {
			setVersionsOf(null);
			return;
		}
		const result = await loadArtifactVersionsAction(key);
		if (!result.ok) {
			notify.error(result.message);
			return;
		}
		setVersions(result.data as Artifact[]);
		setVersionsOf(key);
	}

	async function removeArtifact(row: Artifact) {
		const bound = instanceRows.filter(
			(instance) => instance.definitionKey === row.key,
		);
		const confirmed = await confirm({
			title: `Delete ${row.key} and every version of it?`,
			description: bound.length
				? `${bound.length} instance${bound.length === 1 ? "" : "s"} still run this module. They stop working as soon as the code is gone.`
				: "Every uploaded version goes with it. Restoring means uploading the module again.",
			confirmLabel: "Delete module",
		});
		if (!confirmed) return;
		if (versionsOf === row.key) setVersionsOf(null);
		await actOnArtifact(row.key, {
			optimistic: "removed",
			action: () => deleteArtifactAction(row.key),
			success: `${row.key} deleted`,
			failure: "The module could not be deleted.",
		});
	}

	async function removeInstance(row: Instance) {
		const confirmed = await confirm({
			title: `Delete the instance ${row.id}?`,
			description:
				"It leaves the request path on every replica. The uploaded code stays, so it can be bound again later.",
			confirmLabel: "Delete instance",
		});
		if (!confirmed) return;
		await actOnInstance(row.id, {
			optimistic: "removed",
			action: () => deleteInstanceAction(row.id),
			success: `${row.id} deleted`,
			failure: "The instance could not be deleted.",
		});
	}

	/** Activating is a code change in the request path, which is why it asks first. */
	async function activate(key: string, version: number) {
		const confirmed = await confirm({
			title: `Run v${version} of ${key}?`,
			description:
				"Every instance bound to this module switches to that version on the next reload.",
			confirmLabel: "Activate version",
			tone: "primary",
		});
		if (!confirmed) return;
		const result = await run(() => activateArtifactAction(key, version), {
			success: `${key} now runs v${version}`,
			failure: "The version could not be activated.",
		});
		if (!result.ok) return;
		const refreshed = await loadArtifactVersionsAction(key);
		if (refreshed.ok) setVersions(refreshed.data as Artifact[]);
	}

	const artifactColumns: Column<Artifact>[] = [
		{
			key: "key",
			header: "Key",
			render: (row) => <span className="font-medium">{row.key}</span>,
		},
		{
			key: "version",
			header: "Active version",
			render: (row) => <Mono>v{row.version}</Mono>,
		},
		{
			key: "size",
			header: "Size",
			render: (row) => (
				<span className="text-fg-muted text-xs">{row.sizeBytes} B</span>
			),
		},
		{
			key: "uploadedBy",
			header: "Uploaded by",
			render: (row) =>
				row.uploadedBy ? (
					<span className="text-fg-muted text-xs">{row.uploadedBy}</span>
				) : (
					<Dash />
				),
		},
		{
			key: "actions",
			header: "",
			align: "end",
			render: (row) => (
				<RowActions
					label={`Actions for ${row.key}`}
					actions={[
						{
							label: versionsOf === row.key ? "Hide versions" : "Versions",
							icon: <IconVersions size={15} aria-hidden />,
							onSelect: () => void openVersions(row.key),
						},
						...(editable
							? [
									{
										label: "Upload a version",
										icon: <IconUpload size={15} aria-hidden />,
										onSelect: () => upload(row.key),
									},
									{
										label: "Delete",
										icon: <IconTrash size={15} aria-hidden />,
										danger: true,
										onSelect: () => void removeArtifact(row),
									},
								]
							: []),
					]}
				/>
			),
		},
	];

	const instanceColumns: Column<Instance>[] = [
		{
			key: "id",
			header: "Instance",
			render: (row) => {
				const live = runtimeById.get(row.id);
				return (
					<div className="flex flex-col">
						<span className="font-medium">{row.id}</span>
						{live?.hooks.length ? (
							<span className="text-fg-muted text-xs">
								{live.hooks.join(", ")}
							</span>
						) : null}
					</div>
				);
			},
		},
		{
			key: "definition",
			header: "Definition",
			render: (row) => <Mono>{row.definitionKey}</Mono>,
		},
		{
			key: "status",
			header: "In this replica",
			render: (row) => {
				const live = runtimeById.get(row.id);
				if (!live) return <Status tone="muted">not loaded</Status>;
				return (
					<div className="flex flex-col gap-1">
						<div className="flex items-center gap-1.5">
							<Status tone={instanceTone(live.status)}>{live.status}</Status>
							{live.critical ? <Status tone="warning">critical</Status> : null}
						</div>
						{live.disabledReason ? (
							<span className="text-fg-muted text-xs">
								{live.disabledReason}
							</span>
						) : null}
						{live.lastError ? (
							<span className="text-danger text-xs">{live.lastError}</span>
						) : null}
					</div>
				);
			},
		},
		{
			key: "priority",
			header: "Priority",
			render: (row) => <Mono>{row.priority}</Mono>,
		},
		{
			key: "actions",
			header: "",
			align: "end",
			render: (row) => {
				const live = runtimeById.get(row.id);
				if (!editable) return null;
				return (
					<RowActions
						label={`Actions for ${row.id}`}
						actions={[
							// A breaker trip disables an instance in one replica only, so the reset is
							// offered only while this replica reports it tripped.
							...(live?.status === "runtime_disabled"
								? [
										{
											label: "Reset in this replica",
											icon: <IconRefresh size={15} aria-hidden />,
											onSelect: () =>
												void run(() => resetInstanceAction(row.id), {
													success: `${row.id} reset in this replica`,
													failure: "The instance could not be reset.",
												}),
										},
									]
								: []),
							{
								label: "Edit",
								icon: <IconEdit size={15} aria-hidden />,
								onSelect: () =>
									setDraft({
										id: row.id,
										definition: row.definitionKey,
										enabled: row.enabled,
										critical: Boolean(
											(row as { critical?: boolean | null }).critical,
										),
										priority: row.priority,
										match: JSON.stringify(
											(row as { match?: unknown }).match ?? {},
											null,
											2,
										),
										config: JSON.stringify(
											(row as { config?: unknown }).config ?? {},
											null,
											2,
										),
									}),
							},
							{
								label: "Delete",
								icon: <IconTrash size={15} aria-hidden />,
								danger: true,
								onSelect: () => void removeInstance(row),
							},
						]}
					/>
				);
			},
		},
	];

	return (
		<>
			<div className="flex flex-col gap-6">
				<Card>
					<CardContent className="p-6">
						<div className="flex flex-wrap items-start justify-between gap-3 pb-4">
							<div>
								<h2 className="font-semibold text-fg">Instances</h2>
								<p className="max-w-2xl pt-1 text-fg-muted text-sm">
									One definition running with one configuration. Status is read
									from the replica answering this page — a breaker trip disables
									an instance there, not in the database, so another replica may
									still be running it.
								</p>
							</div>
							<Can permissions={["settings:write"]}>
								<Button
									size="sm"
									variant="secondary"
									disabled={definitions.length === 0}
									onClick={() =>
										setDraft({
											id: "",
											definition: definitions[0] ?? "",
											enabled: true,
											critical: false,
											priority: 0,
											match: "",
											config: "",
										})
									}
								>
									<IconPlus size={15} aria-hidden className="mr-2" />
									New instance
								</Button>
							</Can>
						</div>
						{instanceRows.length === 0 ? (
							<EmptyState
								title="Nothing is running"
								description={
									definitions.length === 0
										? "Upload a module first, then bind it to an instance."
										: "Bind one of the uploaded definitions to an instance to put it in the request path."
								}
							/>
						) : (
							<DataTable
								rows={instanceRows}
								columns={instanceColumns}
								rowKey={(row) => row.id}
								caption="Extension instances"
								pagination={{ pageSize: 10 }}
							/>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardContent className="p-6">
						<div className="pb-4">
							<h2 className="font-semibold text-fg">Code</h2>
							<p className="max-w-2xl pt-1 text-fg-muted text-sm">
								Uploaded modules, versioned. Uploading the same key adds a
								version and activates it; older versions stay and can be
								activated again.
							</p>
						</div>
						{artifactRows.length === 0 ? (
							<EmptyState
								title="No modules uploaded"
								description="Upload an ES module exporting a definition. It is probed before it is stored, so a module that does not load never reaches a request."
							/>
						) : (
							<>
								<DataTable
									rows={artifactRows}
									columns={artifactColumns}
									rowKey={(row) => row.key}
									caption="Extension code"
									pagination={{ pageSize: 10 }}
								/>
								{versionsOf ? (
									<div className="pt-4">
										<h3 className="pb-2 font-medium text-fg text-sm">
											Versions of {versionsOf}
										</h3>
										<ul className="flex flex-col gap-1">
											{versions.map((version) => (
												<li
													key={version.version}
													className="flex items-center gap-3 text-sm"
												>
													<Mono>v{version.version}</Mono>
													<Status
														tone={
															version.status === "active" ? "success" : "muted"
														}
													>
														{version.status}
													</Status>
													<span className="text-fg-muted text-xs">
														{version.contentHash.slice(0, 12)}
													</span>
													{editable && version.status !== "active" ? (
														<Button
															size="sm"
															variant="ghost"
															onClick={() =>
																void activate(versionsOf, version.version)
															}
														>
															Activate
														</Button>
													) : null}
												</li>
											))}
										</ul>
									</div>
								) : null}
							</>
						)}
					</CardContent>
				</Card>
			</div>

			{draft ? (
				<InstanceDialog
					key={draft.id || "new"}
					draft={draft}
					definitions={definitions}
					onClose={() => setDraft(null)}
					onSaved={() => {
						refresh();
						notify.success("Instance saved");
					}}
				/>
			) : null}
		</>
	);
}
