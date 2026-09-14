"use client";

import { type Column, DataTable, Dash, Mono } from "#/components/ui/datatable";
import { useMutation, useRowActions } from "#/shared/lib/mutation.ts";
import { useSearchWriter } from "#/shared/lib/useSearchWriter.ts";
import { RowActions } from "#/shared/components/RowActions.tsx";
import { Pagination } from "#/shared/components/Pagination.tsx";
import { Select, SelectItem } from "#/components/ui/select";
import { type UsersFilters, PAGE_SIZE } from "./filters.ts";
import { useConfirm } from "#/shared/feedback/confirm.tsx";
import { useSession } from "#/features/auth/session.tsx";
import { SessionsDialog } from "./SessionsDialog.tsx";
import { PasswordDialog } from "./PasswordDialog.tsx";
import { EmptyState } from "#/components/ui/page";
import { Status } from "#/components/ui/status";
import { useState } from "react";

import {
	IconCheck,
	IconUsers,
	IconTrash,
	IconBan,
	IconKey,
} from "@tabler/icons-react";

import {
	setPasswordAction,
	deleteUserAction,
	updateUserAction,
} from "./actions.ts";

import {
	type DashboardUser,
	ROLE_SUMMARY,
	type Role,
	ROLES,
} from "./common.ts";

function roleTone(role: Role) {
	return role === "owner" ? "warning" : role === "admin" ? "neutral" : "muted";
}

/** The role legend, which needs no data and so belongs to the route's App Shell. */
export function RoleLegend() {
	return (
		<div className="mb-6 rounded-2xl border border-border/50 bg-surface-2/40 px-5 py-4">
			<p className="pb-2 font-medium text-fg text-sm">
				What each role can reach
			</p>
			<dl className="grid gap-2 text-sm sm:grid-cols-3">
				{ROLES.map((role) => (
					<div key={role}>
						<dt className="pb-1">
							<Status tone={roleTone(role)}>{role}</Status>
						</dt>
						<dd className="text-fg-muted text-xs">{ROLE_SUMMARY[role]}</dd>
					</div>
				))}
			</dl>
		</div>
	);
}

export function UsersTable({
	users: loaded,
	total,
	filters,
}: {
	users: DashboardUser[];
	total: number;
	filters: UsersFilters;
}) {
	const { set } = useSearchWriter(filters);
	const { identity } = useSession();
	const confirm = useConfirm();
	const { pending, run } = useMutation();
	const { rows: users, act } = useRowActions(loaded, (user) => user.id);
	const [inspecting, setInspecting] = useState<DashboardUser | null>(null);
	const [resetting, setResetting] = useState<DashboardUser | null>(null);
	const searched = Boolean(filters.q);
	const offset = filters.offset ?? 0;

	async function changeRole(user: DashboardUser, role: Role) {
		if (role === user.role) return;
		const confirmed = await confirm({
			title: `Make ${user.username} ${role === "owner" ? "an owner" : `a ${role}`}?`,
			description:
				role === "owner"
					? "An owner can manage users and load runtime extensions, which execute code inside the gateway."
					: "Their open sessions are revoked, so the new role takes effect on their next sign in.",
			confirmLabel: "Change role",
			tone: "primary",
		});
		if (!confirmed) return;
		await act(user.id, {
			optimistic: { role },
			action: () => updateUserAction(user.id, { role }),
			success: `${user.username} is now ${role}`,
			failure: "The role could not be changed.",
		});
	}

	async function toggle(user: DashboardUser) {
		await act(user.id, {
			optimistic: { enabled: !user.enabled },
			action: () => updateUserAction(user.id, { enabled: !user.enabled }),
			success: `${user.username} ${user.enabled ? "disabled" : "enabled"}`,
			failure: "The account could not be updated.",
		});
	}

	async function remove(user: DashboardUser) {
		const confirmed = await confirm({
			title: `Delete ${user.username}?`,
			description:
				"Their sessions end immediately and the account is gone. Their past actions stay in the audit trail.",
			confirmLabel: "Delete operator",
		});
		if (!confirmed) return;
		await act(user.id, {
			optimistic: "removed",
			action: () => deleteUserAction(user.id),
			success: `${user.username} deleted`,
			failure: "The operator could not be deleted.",
		});
	}

	const columns: Column<DashboardUser>[] = [
		{
			key: "username",
			header: "Username",
			render: (user) => <span className="font-medium">{user.username}</span>,
		},
		{
			key: "role",
			header: "Role",
			render: (user) => (
				<Select
					aria-label={`Role for ${user.username}`}
					value={user.role}
					disabled={user.id === identity.user.id}
					onValueChange={(key) => void changeRole(user, key as Role)}
				>
					{ROLES.map((role) => (
						<SelectItem key={role} value={role}>
							{role}
						</SelectItem>
					))}
				</Select>
			),
		},
		{
			key: "state",
			header: "State",
			render: (user) => (
				<Status tone={user.enabled ? "success" : "muted"}>
					{user.enabled ? "enabled" : "disabled"}
				</Status>
			),
		},
		{
			key: "mustChange",
			header: "Password",
			render: (user) =>
				user.mustChangePassword ? (
					<Status tone="warning">must change</Status>
				) : (
					<Dash />
				),
		},
		{
			key: "lastLogin",
			header: "Last login",
			render: (user) =>
				user.lastLoginAt ? (
					// The operator's own timezone, which the server does not have.
					<span suppressHydrationWarning className="text-fg-muted text-xs">
						{new Date(user.lastLoginAt).toLocaleString()}
					</span>
				) : (
					<Dash />
				),
		},
		{
			key: "createdBy",
			header: "Created by",
			render: (user) =>
				user.createdBy ? <Mono>{user.createdBy}</Mono> : <Dash />,
		},
		{
			key: "actions",
			header: "",
			align: "end",
			render: (user) => {
				// You cannot disable or delete yourself: the rule is shown, not hidden, so the row
				// reads the same as everyone else's.
				const self = user.id === identity.user.id;
				return (
					<RowActions
						label={`Actions for ${user.username}`}
						actions={[
							{
								label: "Sessions",
								icon: <IconUsers size={15} aria-hidden />,
								onSelect: () => setInspecting(user),
							},
							{
								label: "Reset password",
								icon: <IconKey size={15} aria-hidden />,
								onSelect: () => setResetting(user),
							},
							{
								label: user.enabled ? "Disable" : "Enable",
								icon: user.enabled ? (
									<IconBan size={15} aria-hidden />
								) : (
									<IconCheck size={15} aria-hidden />
								),
								disabled: self,
								onSelect: () => void toggle(user),
							},
							{
								label: "Delete",
								icon: <IconTrash size={15} aria-hidden />,
								danger: true,
								disabled: self,
								onSelect: () => void remove(user),
							},
						]}
					/>
				);
			},
		},
	];

	return (
		<>
			{users.length === 0 ? (
				<EmptyState
					title={
						searched ? "No operators match that search" : "No operators yet"
					}
					description={
						searched
							? "Only usernames are searched."
							: "Only the root operator can sign in. It lives in the environment, not here, so it never appears in this list."
					}
				/>
			) : (
				<>
					<DataTable
						rows={users}
						columns={columns}
						rowKey={(user) => user.id}
						caption="Dashboard users"
					/>
					<Pagination
						label="operators"
						limit={PAGE_SIZE}
						offset={offset}
						total={total}
						onOffsetChange={(next) =>
							set({ offset: next === 0 ? undefined : next })
						}
					/>
				</>
			)}

			<SessionsDialog
				userId={inspecting?.id ?? null}
				username={inspecting?.username ?? ""}
				onClose={() => setInspecting(null)}
			/>

			<PasswordDialog
				isOpen={resetting !== null}
				pending={pending}
				username={resetting?.username ?? ""}
				onClose={() => setResetting(null)}
				onSubmit={async (password) => {
					const target = resetting;
					if (!target) return false;
					const result = await run(
						() => setPasswordAction(target.id, password),
						{
							success: `Password reset for ${target.username}`,
							failure: "The password could not be set.",
						},
					);
					return result.ok;
				}}
			/>
		</>
	);
}
