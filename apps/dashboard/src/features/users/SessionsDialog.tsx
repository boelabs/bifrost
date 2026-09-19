"use client";

import { type Column, DataTable, Dash } from "#/components/ui/datatable";
import { ErrorNote, Loading } from "#/components/ui/page";
import type { DashboardSession } from "./common.ts";
import { loadSessionsAction } from "./actions.ts";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import { useEffect, useState } from "react";

import {
	DialogHeader,
	DialogFooter,
	DialogBody,
	Dialog,
	Modal,
} from "#/components/ui/modal";

/**
 * Who is actually signed in as this account, right now.
 *
 * The gateway has no per-session revoke: disabling the user is what cuts every session at once. So
 * this is deliberately a read — the answer to "is someone else using this account?", which an owner
 * otherwise has no way to ask.
 */
export function SessionsDialog({
	userId,
	username,
	onClose,
}: {
	userId: string | null;
	username: string;
	onClose: () => void;
}) {
	const [sessions, setSessions] = useState<DashboardSession[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!userId) {
			return;
		}
		let cancelled = false;
		setSessions(null);
		setError(null);
		void loadSessionsAction(userId).then((result) => {
			if (cancelled) {
				return;
			}
			if (result.ok) {
				setSessions(result.data);
			} else {
				setError(result.message);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [userId]);

	const columns: Column<DashboardSession>[] = [
		{
			key: "state",
			header: "State",
			render: (session) => {
				const expired = Date.parse(session.expiresAt) < Date.now();
				if (session.revokedAt) {
					return <Status tone="muted">revoked</Status>;
				}
				return expired ? (
					<Status tone="muted">expired</Status>
				) : (
					<Status tone="success">live</Status>
				);
			},
		},
		{
			key: "lastSeen",
			header: "Last seen",
			render: (session) => (
				<span className="text-fg-muted text-xs">
					{new Date(session.lastSeenAt).toLocaleString()}
				</span>
			),
		},
		{
			key: "expires",
			header: "Expires",
			render: (session) => (
				<span className="text-fg-muted text-xs">
					{new Date(session.expiresAt).toLocaleString()}
				</span>
			),
		},
		{
			key: "ip",
			header: "IP",
			render: (session) =>
				session.ip ? <span className="text-xs">{session.ip}</span> : <Dash />,
		},
		{
			key: "agent",
			header: "Client",
			render: (session) =>
				session.userAgent ? (
					<span
						className="line-clamp-1 max-w-64 text-fg-muted text-xs"
						title={session.userAgent}
					>
						{session.userAgent}
					</span>
				) : (
					<Dash />
				),
		},
	];

	return (
		<Modal isOpen={userId !== null} onOpenChange={(open) => !open && onClose()}>
			<Dialog
				aria-label={`Sessions for ${username}`}
				layout="sectioned"
				width="min(100%, 46rem)"
			>
				<DialogHeader>
					<h2 className="font-semibold text-fg text-lg">
						Sessions for {username}
					</h2>
					<p className="pt-2 text-fg-muted text-sm">
						Disabling the account revokes all of them at once; there is no
						per-session sign-out.
					</p>
				</DialogHeader>
				<DialogBody>
					{error ? <ErrorNote>{error}</ErrorNote> : null}
					{!error && sessions === null ? (
						<Loading label="Loading sessions…" />
					) : null}
					{sessions ? (
						<DataTable
							caption={`Sessions for ${username}`}
							columns={columns}
							emptyMessage="No sessions on record. Nobody has signed in as this account."
							rowKey={(session) => session.id}
							rows={sessions}
						/>
					) : null}
				</DialogBody>
				<DialogFooter>
					<Button onClick={onClose} variant="secondary">
						Close
					</Button>
				</DialogFooter>
			</Dialog>
		</Modal>
	);
}
