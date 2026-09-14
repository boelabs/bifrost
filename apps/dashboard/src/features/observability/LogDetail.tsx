"use client";

import { loadOperationDetail, loadPayloadSample } from "./actions.ts";
import { Status, outcomeTone } from "#/components/ui/status";
import { ErrorNote } from "#/components/ui/page";
import { Mono } from "#/components/ui/datatable";
import { Button } from "#/components/ui/button";
import { useEffect, useState } from "react";

import {
	DialogHeader,
	DialogFooter,
	DialogBody,
	Dialog,
	Modal,
} from "#/components/ui/modal";

type Json = Record<string, unknown>;

function Block({ title, value }: { title: string; value: unknown }) {
	if (value === undefined || value === null) return null;
	return (
		<div className="flex flex-col gap-2">
			<h4 className="font-medium text-fg text-xs uppercase tracking-wide">
				{title}
			</h4>
			<pre className="max-h-80 overflow-auto rounded-md bg-surface-2/60 p-3 text-xs leading-relaxed">
				{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
			</pre>
		</div>
	);
}

interface PayloadState {
	retained: boolean;
	readable: boolean;
	access: "open" | "sealed";
	expiresAt: string | null;
}

/**
 * What the operator is looking at before they click anything.
 *
 * The gateway keeps a sample of every finished operation, so the interesting cases are the two where
 * a button would be a lie: a deployment that seals payloads, and a sample retention already swept.
 */
function payloadNote(sample: PayloadState | undefined): string {
	if (!sample) return "Loading…";
	if (sample.access === "sealed")
		return "Sealed on this deployment: the gateway still captures and encrypts every sample, and no operator can read one here.";
	if (!sample.retained)
		return "Nothing retained for this operation — the retention window has passed.";
	const until = sample.expiresAt
		? ` Kept until ${new Date(sample.expiresAt).toLocaleString()}.`
		: "";
	return `The request and response as the gateway saw them. Reading it is recorded in the payload access audit.${until}`;
}

/**
 * One attempt of the operation. The gateway already decides what an attempt means — which
 * deployment, who owned the failure, at what phase — so this only has to stop hiding it.
 */
function Attempt({ attempt }: { attempt: Json }) {
	const error = attempt.error as Json | null | undefined;
	return (
		<li className="flex flex-col gap-1 border-border/40 border-b py-3 last:border-0">
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<Status tone={outcomeTone(String(attempt.outcome ?? ""))}>
					{String(attempt.outcome ?? "unknown")}
				</Status>
				<span className="font-medium text-fg">
					{String(attempt.deploymentLabel ?? attempt.deploymentId ?? "—")}
				</span>
				<Mono>{String(attempt.adapterKey ?? "—")}</Mono>
				{attempt.transport ? <Mono>{String(attempt.transport)}</Mono> : null}
				{typeof attempt.durationMs === "number" ? (
					<span className="text-fg-muted text-xs">{attempt.durationMs} ms</span>
				) : null}
			</div>
			{attempt.failurePhase || attempt.failureOwner || attempt.healthEffect ? (
				<div className="flex flex-wrap gap-3 text-fg-muted text-xs">
					{attempt.failureOwner ? (
						<span>owner: {String(attempt.failureOwner)}</span>
					) : null}
					{attempt.failurePhase ? (
						<span>phase: {String(attempt.failurePhase)}</span>
					) : null}
					{attempt.healthEffect ? (
						<span>health: {String(attempt.healthEffect)}</span>
					) : null}
					{typeof attempt.providerStatus === "number" ? (
						<span>upstream: {attempt.providerStatus}</span>
					) : null}
				</div>
			) : null}
			{error?.code || error?.class ? (
				<p className="text-fg-muted text-xs">
					{String(error.class ?? "")} · {String(error.code ?? "")}
				</p>
			) : null}
		</li>
	);
}

/**
 * The record behind one row of the log: the attempt timeline, the error the caller got, and — only
 * when asked for — the retained request and response.
 *
 * The payload is a separate, deliberate click because reading it is audited and because it is the
 * one part of this view that contains the caller's own content.
 */
export function LogDetail({
	operationId,
	onClose,
}: {
	operationId: string | null;
	onClose: () => void;
}) {
	const [detail, setDetail] = useState<Json | null>(null);
	const [payload, setPayload] = useState<Json | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loadingPayload, setLoadingPayload] = useState(false);

	useEffect(() => {
		if (!operationId) return;
		setDetail(null);
		setPayload(null);
		setError(null);
		let cancelled = false;
		void loadOperationDetail(operationId).then((result) => {
			if (cancelled) return;
			if (result.ok) setDetail(result.data as Json);
			else setError(result.message);
		});
		return () => {
			cancelled = true;
		};
	}, [operationId]);

	async function revealPayload() {
		if (!operationId) return;
		setLoadingPayload(true);
		setError(null);
		const result = await loadPayloadSample(operationId);
		if (result.ok) setPayload(result.data as Json);
		else setError(result.message);
		setLoadingPayload(false);
	}

	const attempts = (detail?.attempts ?? []) as Json[];
	const opError = detail?.error as Json | null | undefined;
	const sample = detail?.payload as PayloadState | undefined;

	return (
		<Modal
			isOpen={operationId !== null}
			onOpenChange={(open) => !open && onClose()}
		>
			<Dialog layout="sectioned" aria-label="Operation detail">
				<DialogHeader>
					<h2 className="font-semibold text-fg text-lg">Operation</h2>
					<p className="pt-2 text-fg-muted text-sm">
						{detail ? (
							<>
								<Mono>{String(detail.publicModel ?? "—")}</Mono> ·{" "}
								{String(detail.callType ?? "")} ·{" "}
								{String(detail.durationMs ?? "?")} ms · request{" "}
								<Mono>{String(detail.requestId ?? "")}</Mono>
							</>
						) : (
							"Loading…"
						)}
					</p>
				</DialogHeader>

				<DialogBody>
					<div className="flex flex-col gap-6">
						{opError ? (
							<div className="flex flex-col gap-2">
								<h4 className="font-medium text-fg text-xs uppercase tracking-wide">
									Error returned to the caller
								</h4>
								<p className="text-sm">
									<Status tone="danger">
										{String(opError.code ?? opError.class ?? "error")}
									</Status>{" "}
									<span className="text-fg-muted">
										HTTP {String(opError.http_status ?? "?")}
									</span>
								</p>
								{opError.message ? (
									<p className="text-fg-muted text-xs">
										{String(opError.message)}
									</p>
								) : null}
							</div>
						) : null}

						<div className="flex flex-col gap-1">
							<h4 className="font-medium text-fg text-xs uppercase tracking-wide">
								Attempts ({attempts.length})
							</h4>
							{attempts.length === 0 ? (
								<p className="py-2 text-fg-muted text-sm">
									No upstream was contacted — the request never left the
									gateway.
								</p>
							) : (
								<ul className="flex flex-col">
									{attempts.map((attempt, index) => (
										<Attempt
											key={String(attempt.id ?? index)}
											attempt={attempt}
										/>
									))}
								</ul>
							)}
						</div>

						<div className="flex flex-col gap-3 border-border/50 border-t pt-5">
							<div className="flex flex-wrap items-start justify-between gap-3">
								<div>
									<h4 className="font-medium text-fg text-xs uppercase tracking-wide">
										Retained payload
									</h4>
									<p className="max-w-xl pt-1 text-fg-muted text-xs">
										{payloadNote(sample)}
									</p>
								</div>
								{payload === null && sample?.readable ? (
									<Button
										size="sm"
										variant="secondary"
										disabled={loadingPayload}
										onClick={revealPayload}
									>
										{loadingPayload ? "Loading…" : "Reveal payload"}
									</Button>
								) : null}
							</div>
							{payload ? (
								<div className="flex flex-col gap-4">
									<Block title="Request" value={payload.request} />
									<Block title="Response" value={payload.response} />
									<Block title="Error" value={payload.error} />
									<Block title="Attempts" value={payload.attempts} />
								</div>
							) : null}
						</div>

						{error ? <ErrorNote>{error}</ErrorNote> : null}
					</div>
				</DialogBody>

				<DialogFooter>
					<Button variant="secondary" onClick={onClose}>
						Close
					</Button>
				</DialogFooter>
			</Dialog>
		</Modal>
	);
}
