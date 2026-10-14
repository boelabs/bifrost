"use client";

import { loadOperationDetail, loadPayloadSample } from "./actions.ts";
import { Status, outcomeTone } from "#/components/ui/status";
import type { components } from "#/shared/api/schema";
import { ErrorNote } from "#/components/ui/page";
import { Mono } from "#/components/ui/datatable";
import { Button } from "#/components/ui/button";
import type { OperationDetail } from "./api.ts";
import { useEffect, useState } from "react";

import {
	DialogHeader,
	DialogFooter,
	DialogBody,
	Dialog,
	Modal,
} from "#/components/ui/modal";

import {
	formatDuration,
	formatBytes,
	causeLabel,
	phaseLabel,
	percentOf,
} from "./trace.ts";

type Attempt = components["schemas"]["UpstreamAttempt"];
type Json = Record<string, unknown>;

function Block({ title, value }: { title: string; value: unknown }) {
	if (value === undefined || value === null) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			<h4 className="font-medium text-fg text-xs uppercase tracking-wide">
				{title}
			</h4>
			<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2/60 p-3 text-xs leading-relaxed">
				{typeof value === "string" ? value : JSON.stringify(value, null, 2)}
			</pre>
		</div>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="flex flex-col gap-2">
			<h4 className="font-medium text-fg text-xs uppercase tracking-wide">
				{title}
			</h4>
			{children}
		</section>
	);
}

/** A term and its value; a missing value is left out rather than shown as a dash wall. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	return (
		<div className="flex min-w-0 flex-col">
			<dt className="text-fg-muted text-xs">{label}</dt>
			<dd className="break-words text-sm tabular-nums">{value}</dd>
		</div>
	);
}

interface PayloadState {
	retained: boolean;
	readable: boolean;
	access: "open" | "sealed";
	expiresAt: string | null;
}

function payloadNote(sample: PayloadState | undefined): string {
	if (!sample) {
		return "Loading…";
	}
	if (sample.access === "sealed") {
		return "Sealed on this deployment: the gateway still captures and encrypts every sample, and no operator can read one here.";
	}
	if (!sample.retained) {
		return "Nothing retained for this operation — the retention window has passed.";
	}
	const until = sample.expiresAt
		? ` Kept until ${new Date(sample.expiresAt).toLocaleString()}.`
		: "";
	return `The request and response as the gateway saw them. Reading it is recorded in the payload access audit.${until}`;
}

const BAR_TONES: Record<string, string> = {
	success: "bg-success/70",
	error: "bg-destructive/70",
};

const OWNERS: Record<string, string> = {
	provider: "provider",
	gateway_deadline: "gateway deadline",
	deployment_config: "deployment configuration",
	client: "caller",
	gateway: "gateway",
};

/**
 * The attempt on the request's own clock: where it started, when headers and the first output
 * arrived, and when it ended. Spans are drawn against the whole operation, so a retry reads as a
 * second bar after the first instead of as a second number to compare.
 */
function AttemptBar({
	attempt,
	operationStart,
	operationMs,
}: {
	attempt: Attempt;
	operationStart: number;
	operationMs: number;
}) {
	const offset = Date.parse(attempt.startedAt) - operationStart;
	const left = percentOf(offset, operationMs);
	const width = Math.max(0.75, percentOf(attempt.durationMs ?? 0, operationMs));
	const tone = BAR_TONES[attempt.outcome] ?? "bg-warning/70";
	const mark = (atMs: number | null, label: string) =>
		atMs === null ? null : (
			<span
				aria-hidden
				className="absolute top-[-3px] bottom-[-3px] w-0.5 rounded bg-fg"
				style={{ left: `${percentOf(offset + atMs, operationMs)}%` }}
				title={`${label} at ${formatDuration(atMs)}`}
			/>
		);
	return (
		<div
			aria-label={`Started at ${formatDuration(offset)}, lasted ${formatDuration(attempt.durationMs)}`}
			className="relative h-2 w-full rounded-full bg-surface-2"
			role="img"
		>
			<span
				className={`absolute inset-y-0 rounded-full ${tone}`}
				style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
			/>
			{mark(attempt.headersMs, "Headers")}
			{mark(attempt.firstOutputMs, "First output")}
		</div>
	);
}

function AttemptCard({
	attempt,
	operationStart,
	operationMs,
}: {
	attempt: Attempt;
	operationStart: number;
	operationMs: number;
}) {
	const { error } = attempt;
	const provider = error?.provider;
	const diagnostics = attempt.diagnostics as Json;
	const metadata = (diagnostics.metadata ?? {}) as Json;
	const anomalies = Array.isArray(metadata.anomalies)
		? (metadata.anomalies as string[])
		: [];
	const failure =
		attempt.outcome === "error"
			? {
					owner: attempt.failureOwner,
					phase: attempt.failurePhase,
					kind: attempt.failureKind,
					providerStatus: attempt.providerStatus,
				}
			: null;
	const tokens =
		attempt.totalTokens === null
			? null
			: `${attempt.totalTokens.toLocaleString()}${
					attempt.promptTokens === null || attempt.completionTokens === null
						? ""
						: ` (${attempt.promptTokens.toLocaleString()} in · ${attempt.completionTokens.toLocaleString()} out)`
				}`;

	return (
		<li className="flex flex-col gap-3 border-border/40 border-b py-4 last:border-0">
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span className="text-fg-muted tabular-nums">#{attempt.ordinal}</span>
				<Status tone={outcomeTone(attempt.outcome)}>{attempt.outcome}</Status>
				<span className="font-medium text-fg">
					{attempt.deploymentLabel ?? attempt.deploymentId ?? "—"}
				</span>
				<Mono>
					{[attempt.adapterKey, attempt.transport, attempt.upstreamModel]
						.filter(Boolean)
						.join(" · ")}
				</Mono>
				<span className="ml-auto text-fg-muted text-xs tabular-nums">
					{formatDuration(attempt.durationMs)}
				</span>
			</div>

			<AttemptBar
				attempt={attempt}
				operationMs={operationMs}
				operationStart={operationStart}
			/>

			{failure ? (
				<div className="flex flex-col gap-2 rounded-md border border-destructive/24 bg-destructive/4 p-3">
					<p className="font-medium text-sm">
						{causeLabel(failure)}
						<span className="font-normal text-fg-muted">
							{" · "}
							{OWNERS[attempt.failureOwner ?? ""] ?? "unknown owner"}
							{phaseLabel(attempt.failurePhase)
								? ` · ${phaseLabel(attempt.failurePhase)}`
								: ""}
						</span>
					</p>
					{provider?.message ? (
						<p className="whitespace-pre-wrap break-words text-sm">
							{provider.message}
						</p>
					) : null}
					{provider?.type || provider?.code || provider?.param ? (
						<p className="text-fg-muted text-xs">
							{[
								provider.type && `type ${provider.type}`,
								provider.code && `code ${provider.code}`,
								provider.param && `param ${provider.param}`,
							]
								.filter(Boolean)
								.join(" · ")}
						</p>
					) : null}
					{error?.message && error.message !== provider?.message ? (
						<p className="whitespace-pre-wrap break-words font-mono text-fg-muted text-xs">
							{error.message}
						</p>
					) : null}
				</div>
			) : null}

			<dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
				<Fact
					label="Headers"
					value={
						attempt.headersMs === null
							? null
							: formatDuration(attempt.headersMs)
					}
				/>
				<Fact
					label="First output"
					value={
						attempt.firstOutputMs === null
							? null
							: formatDuration(attempt.firstOutputMs)
					}
				/>
				<Fact
					label="Longest gap"
					value={
						attempt.maxInterEventGapMs === null
							? null
							: formatDuration(attempt.maxInterEventGapMs)
					}
				/>
				<Fact
					label="Upstream bytes"
					value={
						attempt.upstreamBytes === null
							? null
							: formatBytes(attempt.upstreamBytes)
					}
				/>
				<Fact label="Tokens" value={tokens} />
				<Fact
					label="Provider status"
					value={
						attempt.providerStatus === null
							? null
							: String(attempt.providerStatus)
					}
				/>
				<Fact
					label="Retry-After"
					value={
						error?.retryAfterMs === undefined
							? null
							: formatDuration(error.retryAfterMs)
					}
				/>
				<Fact
					label="Finish"
					value={
						typeof diagnostics.terminalReason === "string"
							? diagnostics.terminalReason
							: null
					}
				/>
				<Fact
					label="Provider request"
					value={
						typeof diagnostics.providerRequestId === "string" ? (
							<Mono>{diagnostics.providerRequestId}</Mono>
						) : null
					}
				/>
				<Fact
					label="Health"
					value={
						attempt.healthEffect === "penalize" ? "counted against it" : null
					}
				/>
			</dl>

			{anomalies.length > 0 ? (
				<p className="text-fg-muted text-xs">
					Tolerated:{" "}
					{anomalies.map((item) => item.replaceAll("_", " ")).join(", ")}
				</p>
			) : null}
		</li>
	);
}

/**
 * Everything the gateway recorded about one request: what the caller got, every upstream attempt on
 * one timeline with the provider's own answer, and — only when asked for — the retained payload.
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
	const [detail, setDetail] = useState<OperationDetail | null>(null);
	const [payload, setPayload] = useState<Json | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loadingPayload, setLoadingPayload] = useState(false);

	useEffect(() => {
		if (!operationId) {
			return;
		}
		setDetail(null);
		setPayload(null);
		setError(null);
		let cancelled = false;
		void loadOperationDetail(operationId).then((result) => {
			if (cancelled) {
				return;
			}
			if (result.ok) {
				setDetail(result.data as OperationDetail);
			} else {
				setError(result.message);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [operationId]);

	async function revealPayload() {
		if (!operationId) {
			return;
		}
		setLoadingPayload(true);
		setError(null);
		const result = await loadPayloadSample(operationId);
		if (result.ok) {
			setPayload(result.data as Json);
		} else {
			setError(result.message);
		}
		setLoadingPayload(false);
	}

	const attempts = detail?.attempts ?? [];
	const opError = detail?.error as Json | null | undefined;
	const sample = detail?.payload as PayloadState | undefined;
	const operationStart = detail ? Date.parse(detail.startedAt) : 0;
	const operationMs = Math.max(
		1,
		detail?.durationMs ?? 0,
		...attempts.map(
			(attempt) =>
				Date.parse(attempt.startedAt) -
				operationStart +
				(attempt.durationMs ?? 0),
		),
	);
	const details = (detail ?? {}) as Json;
	const metadata = (details.metadata ?? {}) as Json;
	const terminal = (metadata.terminal ??
		(metadata.streamLifecycle as Json | undefined)?.terminal) as
		| Json
		| null
		| undefined;

	return (
		<Modal
			isOpen={operationId !== null}
			onOpenChange={(open) => !open && onClose()}
			width="min(100%, 56rem)"
		>
			<Dialog aria-label="Operation detail" layout="sectioned">
				<DialogHeader>
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="font-semibold text-foreground text-xl">
							{detail?.publicModel ?? "Operation"}
						</h2>
						{detail ? (
							<>
								<Status tone={outcomeTone(detail.outcome)}>
									{detail.outcome ?? "in progress"}
								</Status>
								{detail.httpStatus === null ? null : (
									<Mono>HTTP {detail.httpStatus}</Mono>
								)}
								{detail.stream ? <Status tone="muted">stream</Status> : null}
							</>
						) : null}
					</div>
					<p className="pt-2 text-fg-muted text-sm">
						{detail ? (
							<>
								{detail.callType} · request <Mono>{detail.requestId}</Mono>
							</>
						) : (
							"Loading…"
						)}
					</p>
				</DialogHeader>

				<DialogBody>
					{detail ? (
						<div className="flex flex-col gap-6">
							<dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
								<Fact
									label="Started"
									value={new Date(detail.startedAt).toLocaleString()}
								/>
								<Fact
									label="Duration"
									value={formatDuration(detail.durationMs)}
								/>
								<Fact
									label="First output"
									value={
										detail.firstOutputMs === null
											? null
											: formatDuration(detail.firstOutputMs)
									}
								/>
								<Fact
									label="Tokens"
									value={
										typeof details.totalTokens === "number"
											? details.totalTokens.toLocaleString()
											: null
									}
								/>
								<Fact
									label="Cost"
									value={
										typeof details.consumerCostCents === "string" &&
										Number(details.consumerCostCents) > 0
											? `$${(Number(details.consumerCostCents) / 100).toFixed(6)}`
											: null
									}
								/>
								<Fact
									label="Finish"
									value={
										typeof terminal?.reason === "string"
											? terminal.reason
											: null
									}
								/>
								<Fact label="Attempts" value={String(attempts.length)} />
								<Fact
									label="Actor"
									value={
										typeof details.actor === "string" ? (
											<Mono>{details.actor}</Mono>
										) : null
									}
								/>
							</dl>

							{opError ? (
								<Section title="What the caller received">
									<p className="text-sm">
										<Status tone="danger">
											{String(opError.code ?? opError.class ?? "error")}
										</Status>{" "}
										<span className="text-fg-muted">
											HTTP {String(opError.http_status ?? "?")}
										</span>
									</p>
									{typeof opError.message === "string" ? (
										<p className="whitespace-pre-wrap break-words font-mono text-fg-muted text-xs">
											{opError.message}
										</p>
									) : null}
								</Section>
							) : null}

							<Section title={`Attempts (${attempts.length})`}>
								{attempts.length > 0 ? (
									<p className="text-fg-muted text-xs">
										Each bar spans the whole request; ticks mark when headers
										and the first output arrived.
									</p>
								) : null}
								{attempts.length === 0 ? (
									<p className="py-2 text-fg-muted text-sm">
										No upstream was contacted — the request never left the
										gateway.
									</p>
								) : (
									<ul className="flex flex-col">
										{attempts.map((attempt) => (
											<AttemptCard
												attempt={attempt}
												key={attempt.id}
												operationMs={operationMs}
												operationStart={operationStart}
											/>
										))}
									</ul>
								)}
							</Section>

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
											disabled={loadingPayload}
											onClick={revealPayload}
											size="sm"
											variant="secondary"
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
						</div>
					) : null}

					{error ? <ErrorNote>{error}</ErrorNote> : null}
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
