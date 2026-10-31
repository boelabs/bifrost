"use client";

import { Check as IconCheck, Copy as IconCopy } from "lucide-react";
import { DetailLayout } from "#/shared/components/DetailLayout.tsx";
import { Breadcrumbs } from "#/shared/components/Breadcrumbs.tsx";
import { ButtonSkeleton } from "#/shared/components/Skeleton.tsx";
import { ErrorNote, PageHeader } from "#/components/ui/page";
import { Status, outcomeTone } from "#/components/ui/status";
import { type ReactNode, Suspense, useState } from "react";
import { Panel } from "#/shared/components/Panel.tsx";
import type { components } from "#/shared/api/schema";
import { Can } from "#/features/auth/session.tsx";
import { Mono } from "#/components/ui/datatable";
import { loadPayloadSample } from "./actions.ts";
import { Button } from "#/components/ui/button";
import type { OperationDetail } from "./api.ts";

import {
	formatDuration,
	formatBytes,
	causeLabel,
	phaseLabel,
	percentOf,
	shortId,
} from "./trace.ts";

import {
	type DetailItem,
	DetailList,
} from "#/shared/components/DetailList.tsx";

type Attempt = components["schemas"]["UpstreamAttempt"];
type PayloadState = components["schemas"]["RetainedPayloadState"];
type Json = Record<string, unknown>;

/**
 * A timestamp in the operator's own clock and timezone, which the server does not have: the markup
 * it streamed is expected to differ from what hydration produces here.
 */
function LocalTime({ iso }: { iso: string }) {
	return (
		<time dateTime={iso} suppressHydrationWarning>
			{new Date(iso).toLocaleString()}
		</time>
	);
}

function CopyButton({ value, label }: { value: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<Button
			aria-label={copied ? "Copied" : label}
			mode="icon"
			onClick={() => {
				navigator.clipboard
					.writeText(value)
					.then(() => {
						setCopied(true);
						window.setTimeout(() => setCopied(false), 1500);
					})
					.catch(() => setCopied(false));
			}}
			size="xs"
			title={label}
			variant="ghost"
		>
			{copied ? (
				<IconCheck aria-hidden className="size-3.5" />
			) : (
				<IconCopy aria-hidden className="size-3.5" />
			)}
		</Button>
	);
}

/** An identifier to read and copy whole. */
function CopyableId({ value, label }: { value: string; label: string }) {
	return (
		<span className="flex items-center gap-1 break-all font-mono text-xs">
			{value}
			<CopyButton label={label} value={value} />
		</span>
	);
}

/** A retained payload part, formatted and ready to copy. */
function JsonPanel({ title, value }: { title: string; value: unknown }) {
	if (value === undefined || value === null) {
		return null;
	}
	const text =
		typeof value === "string" ? value : JSON.stringify(value, null, 2);
	return (
		<Panel
			action={<CopyButton label={`Copy ${title.toLowerCase()}`} value={text} />}
			flush
			title={title}
		>
			<pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap break-words p-5 font-mono text-xs leading-relaxed">
				{text}
			</pre>
		</Panel>
	);
}

/** A term and its value; a missing value is left out rather than shown as a dash wall. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
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

/** The aside's lists leave a missing value out too, rather than listing dashes. */
function present(items: DetailItem[]): DetailItem[] {
	return items.filter(
		(item) =>
			item.value !== null && item.value !== undefined && item.value !== "",
	);
}

function payloadNote(sample: PayloadState): ReactNode {
	if (sample.access === "sealed") {
		return "Sealed on this deployment: the gateway still captures and encrypts every sample, and no operator can read one here.";
	}
	if (!sample.retained) {
		return "Nothing retained for this operation — the retention window has passed.";
	}
	return (
		<>
			The request and response as the gateway saw them. Reading it is recorded
			in the payload access audit.
			{sample.expiresAt ? (
				<>
					{" "}
					Kept until <LocalTime iso={sample.expiresAt} />.
				</>
			) : null}
		</>
	);
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
		<li className="flex flex-col gap-3 border-border/40 border-b py-4 first:pt-0 last:border-0 last:pb-0">
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
 * The retained sample, behind its own click.
 *
 * Reading it is audited by the gateway and it is the one part of this page that holds the caller's
 * own content, so opening the page never fetches it: only "Reveal payload" does, through a Server
 * Action, and only for a role allowed to read payloads.
 */
function RetainedPayload({
	operationId,
	sample,
}: {
	operationId: string;
	sample: PayloadState;
}) {
	const [payload, setPayload] = useState<Json | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function reveal() {
		setLoading(true);
		setError(null);
		const result = await loadPayloadSample(operationId);
		if (result.ok) {
			setPayload(result.data);
		} else {
			setError(result.message);
		}
		setLoading(false);
	}

	return (
		<>
			<Panel
				action={
					payload === null && sample.readable ? (
						<Suspense fallback={<ButtonSkeleton label={14} />}>
							<Can permissions={["payloads:read"]}>
								<Button
									loading={loading}
									onClick={reveal}
									size="sm"
									variant="secondary"
								>
									Reveal payload
								</Button>
							</Can>
						</Suspense>
					) : null
				}
				title="Retained payload"
			>
				<div className="flex flex-col gap-3">
					<p className="text-muted-foreground text-sm">{payloadNote(sample)}</p>
					{error ? <ErrorNote>{error}</ErrorNote> : null}
				</div>
			</Panel>
			{payload ? (
				<>
					<JsonPanel title="Request" value={payload.request} />
					<JsonPanel title="Response" value={payload.response} />
					<JsonPanel title="Error" value={payload.error} />
					<JsonPanel title="Attempt payloads" value={payload.attempts} />
				</>
			) : null}
		</>
	);
}

/**
 * Everything the gateway recorded about one request: what the caller got, every upstream attempt on
 * one timeline with the provider's own answer, and — only when asked for — the retained payload.
 */
export function LogDetail({ detail }: { detail: OperationDetail }) {
	const { attempts } = detail;
	const opError = detail.error;
	const operationStart = Date.parse(detail.startedAt);
	const operationMs = Math.max(
		1,
		detail.durationMs ?? 0,
		...attempts.map(
			(attempt) =>
				Date.parse(attempt.startedAt) -
				operationStart +
				(attempt.durationMs ?? 0),
		),
	);
	const metadata = (detail.metadata ?? {}) as Json;
	const terminal = (metadata.terminal ??
		(metadata.streamLifecycle as Json | undefined)?.terminal) as
		| Json
		| null
		| undefined;
	const cost =
		typeof detail.consumerCostCents === "string" &&
		Number(detail.consumerCostCents) > 0
			? `$${(Number(detail.consumerCostCents) / 100).toFixed(6)}`
			: null;
	const usage = present([
		{
			label: "Tokens",
			value:
				typeof detail.totalTokens === "number"
					? detail.totalTokens.toLocaleString()
					: null,
		},
		{ label: "Cost", value: cost },
	]);

	return (
		<>
			<Breadcrumbs
				items={[
					{ label: "Logs", href: "/logs" },
					{ label: shortId(detail.id) },
				]}
				recent={`${detail.publicModel ?? detail.callType} · ${shortId(detail.id)}`}
			/>
			<PageHeader
				badge={
					<>
						<Status tone={outcomeTone(detail.outcome)}>
							{detail.outcome ?? "in progress"}
						</Status>
						{detail.httpStatus === null ? null : (
							<Mono>HTTP {detail.httpStatus}</Mono>
						)}
						{detail.stream ? <Status tone="muted">stream</Status> : null}
					</>
				}
				description={
					<>
						{detail.callType} · <LocalTime iso={detail.startedAt} />
					</>
				}
				title={
					<span className="break-all">
						{detail.publicModel ?? detail.callType}
					</span>
				}
			/>
			<DetailLayout
				aside={
					<>
						<Panel title="Summary">
							<DetailList
								items={present([
									{
										label: "Operation ID",
										value: (
											<CopyableId label="Copy operation ID" value={detail.id} />
										),
									},
									{
										label: "Request ID",
										value: (
											<CopyableId
												label="Copy request ID"
												value={detail.requestId}
											/>
										),
									},
									{ label: "Public model", value: detail.publicModel },
									{ label: "Call type", value: detail.callType },
									{
										label: "Actor",
										value:
											typeof detail.actor === "string" ? (
												<span className="break-all font-mono text-xs">
													{detail.actor}
												</span>
											) : null,
									},
									{
										label: "Started",
										value: <LocalTime iso={detail.startedAt} />,
									},
								])}
							/>
						</Panel>
						<Panel title="Timing">
							<DetailList
								items={present([
									{
										label: "Duration",
										value: formatDuration(detail.durationMs),
									},
									{
										label: "First output",
										value:
											detail.firstOutputMs === null
												? null
												: formatDuration(detail.firstOutputMs),
									},
									{
										label: "Finish",
										value:
											typeof terminal?.reason === "string"
												? terminal.reason
												: null,
									},
									{ label: "Attempts", value: String(attempts.length) },
								])}
							/>
						</Panel>
						{usage.length > 0 ? (
							<Panel title="Usage">
								<DetailList items={usage} />
							</Panel>
						) : null}
					</>
				}
			>
				{opError ? (
					<Panel title="What the caller received">
						<div className="flex flex-col gap-2">
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
						</div>
					</Panel>
				) : null}

				<Panel
					description={
						attempts.length > 0
							? "Each bar spans the whole request; ticks mark when headers and the first output arrived."
							: undefined
					}
					title={`Attempts (${attempts.length})`}
				>
					{attempts.length === 0 ? (
						<p className="text-fg-muted text-sm">
							No upstream was contacted — the request never left the gateway.
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
				</Panel>

				<RetainedPayload operationId={detail.id} sample={detail.payload} />
			</DetailLayout>
		</>
	);
}
