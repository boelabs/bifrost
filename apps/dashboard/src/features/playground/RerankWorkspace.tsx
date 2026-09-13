"use client";

import { MESSAGE_ACTION, MESSAGE_ACTION_ICON } from "./MessageParts";
import { IconChevronDown, IconRotate2 } from "@tabler/icons-react";
import type { ModelChoice, PlaygroundModel } from "./models";
import { NumberField } from "#/components/ui/number-field";
import { buttonStyles } from "#/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { ResponseLoader } from "./ResponseLoader";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import { ModelSelect } from "./ModelSelect";
import { Workspace } from "./Workspace";
import { Composer } from "./Composer";

import {
	DialogDescription,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogClose,
	DialogTitle,
	DialogBody,
	DialogRoot,
} from "#/components/ui/dialog";

import {
	type RerankSettings,
	emptyRerankSettings,
	type RerankRun,
	rankingFrom,
	runRerank,
} from "./rerank";

/** One document per line, the same rule the embedding batch uses. */
export function documentsFrom(draft: string): string[] {
	return draft
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

function duration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * The documents, above the query.
 *
 * They are the larger half of the request and they change less often than the query, so they get
 * their own box that can be folded away once it is filled — the query stays where every other
 * capability puts its prompt.
 */
function Documents({
	value,
	onChange,
	count,
	disabled,
}: {
	value: string;
	onChange: (value: string) => void;
	count: number;
	disabled: boolean;
}) {
	const [open, setOpen] = useState(true);
	return (
		<section
			aria-label="Documents"
			className="mb-2 overflow-hidden rounded-[28px] border border-border bg-surface-2 max-sm:rounded-2xl"
		>
			<button
				type="button"
				onClick={() => setOpen((current) => !current)}
				aria-expanded={open}
				className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm"
			>
				<span className="font-medium">Documents</span>
				<span className="text-fg-muted text-xs">
					{count === 0
						? "one per line"
						: `${count} ${count === 1 ? "document" : "documents"}`}
				</span>
				<IconChevronDown
					className={`ml-auto size-4 text-fg-muted transition-transform ${open ? "rotate-180" : ""}`}
					aria-hidden
				/>
			</button>
			{open ? (
				<textarea
					aria-label="Documents, one per line"
					value={value}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
					rows={4}
					placeholder={"Paris is the capital of France.\nBerlin is in Germany."}
					className="max-h-64 w-full resize-y bg-transparent px-4 pb-3 text-sm leading-6 outline-none placeholder:text-fg-muted"
				/>
			) : null}
		</section>
	);
}

function RerankRunView({
	run,
	onRetry,
}: {
	run: RerankRun;
	onRetry: () => void;
}) {
	const top = run.results[0]?.score;
	return (
		<section
			aria-label="Rerank run"
			className="flex w-full flex-col gap-4 px-4 last:min-h-[calc(var(--transcript-height,0px)-3.5rem)]"
		>
			<article
				aria-label="You message"
				className="ml-auto flex w-full max-w-[90%] flex-col items-end gap-1"
			>
				<p className="w-fit max-w-full overflow-hidden break-words rounded-3xl border border-border/60 bg-surface-2 px-3.5 py-2.5 text-base leading-6 [overflow-wrap:anywhere]">
					{run.query}
				</p>
				<span className="text-fg-muted text-xs">
					against {run.documents.length}{" "}
					{run.documents.length === 1 ? "document" : "documents"}
				</span>
			</article>
			<article
				aria-label="Assistant message"
				className="flex w-full min-w-0 flex-col gap-2"
			>
				{run.state === "running" ? <ResponseLoader /> : null}
				{run.state === "stopped" ? (
					<div className="text-fg-muted text-xs">
						<Status tone="muted">Stopped</Status>
					</div>
				) : null}
				{run.results.length ? (
					<ol className="flex flex-col gap-1.5">
						{run.results.map((result, position) => (
							// A ranking names each document once, so its original position is its identity.
							<li
								key={result.index}
								className="relative overflow-hidden rounded-xl border border-border/50 bg-card"
							>
								<div
									aria-hidden
									className="absolute inset-y-0 left-0 bg-primary/15"
									style={{
										width: `${top ? Math.max(0, Math.min(1, result.score / top)) * 100 : 0}%`,
									}}
								/>
								<div className="relative flex items-start gap-3 px-3 py-2">
									<span className="w-4 shrink-0 text-fg-muted text-xs tabular-nums">
										{position + 1}
									</span>
									<p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
										{result.text}
									</p>
									<span className="shrink-0 font-mono text-xs">
										{result.score.toFixed(4)}
									</span>
									<span className="shrink-0 text-fg-muted text-xs">
										#{result.index + 1}
									</span>
								</div>
							</li>
						))}
					</ol>
				) : null}
				{run.error ? (
					<ErrorNote width="fit-content">{run.error}</ErrorNote>
				) : null}
				<div className="-ml-2 flex h-10 shrink-0 items-center gap-0.5 lg:h-8">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						mode="icon"
						className={MESSAGE_ACTION}
						aria-label="Run this query again"
						title="Run this query again"
						disabled={run.state === "running"}
						onClick={onRetry}
					>
						<IconRotate2 className={MESSAGE_ACTION_ICON} aria-hidden />
					</Button>
					<p className="px-2 text-fg-muted text-xs">
						{[
							run.model,
							run.settings.topN !== undefined
								? `top ${run.settings.topN}`
								: undefined,
							run.durationMs !== undefined
								? duration(run.durationMs)
								: undefined,
							run.totalTokens !== undefined
								? `${run.totalTokens.toLocaleString()} tokens`
								: undefined,
							run.searchUnits !== undefined
								? `${run.searchUnits.toLocaleString()} search units`
								: undefined,
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</div>
			</article>
		</section>
	);
}

/**
 * Reranking: a query against documents, and what the model does to their order.
 *
 * Each result keeps the position it was sent in, because the interesting part of a ranking is what
 * moved; the bar behind a row is its score relative to the best one, so a flat ranking looks flat.
 */
export function RerankWorkspace({
	model,
	models,
	onSelect,
}: {
	model: PlaygroundModel;
	models: PlaygroundModel[];
	onSelect: (choice: ModelChoice) => void;
}) {
	const [settings, setSettings] = useState<RerankSettings>(emptyRerankSettings);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [draft, setDraft] = useState("");
	const [runs, setRuns] = useState<RerankRun[]>([]);
	const [localError, setLocalError] = useState<string>();
	const request = useRef<AbortController | null>(null);
	const alive = useRef(true);
	const scroll = useRef<HTMLDivElement>(null);
	const documents = documentsFrom(draft);
	const busy = runs.some((run) => run.state === "running");

	useEffect(() => {
		alive.current = true;
		return () => {
			alive.current = false;
			request.current?.abort();
		};
	}, []);

	useEffect(() => {
		if (runs.length && scroll.current)
			scroll.current.scrollTop = scroll.current.scrollHeight;
	}, [runs]);

	function update(id: string, patch: Partial<RerankRun>) {
		setRuns((current) =>
			current.map((run) => (run.id === id ? { ...run, ...patch } : run)),
		);
	}

	async function send(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (busy) {
			setLocalError("Wait for the current ranking to finish.");
			return;
		}
		if (!query.trim()) {
			setLocalError("Enter a query to rank the documents against.");
			return;
		}
		if (!documents.length) {
			setLocalError("Add at least one document, one per line.");
			return;
		}
		setLocalError(undefined);
		const id = crypto.randomUUID();
		const asked = { query: query.trim(), documents };
		setRuns((current) => [
			...current,
			{
				id,
				...asked,
				model: model.id,
				settings,
				state: "running",
				results: [],
			},
		]);
		setQuery("");
		const controller = new AbortController();
		request.current = controller;
		const started = performance.now();
		try {
			const response = await runRerank(
				{ model: model.id, ...asked, settings },
				{ signal: controller.signal },
			);
			if (!alive.current) return;
			update(id, {
				state: "completed",
				results: rankingFrom(response, asked.documents),
				durationMs: performance.now() - started,
				...(response.usage?.total_tokens !== undefined
					? { totalTokens: response.usage.total_tokens }
					: {}),
				...(response.usage?.search_units !== undefined
					? { searchUnits: response.usage.search_units }
					: {}),
			});
		} catch (cause) {
			if (!alive.current) return;
			const stopped = cause instanceof Error && cause.name === "AbortError";
			update(id, {
				state: stopped ? "stopped" : "failed",
				durationMs: performance.now() - started,
				...(stopped
					? {}
					: {
							error:
								cause instanceof Error
									? cause.message
									: "The rerank request failed.",
						}),
			});
		} finally {
			request.current = null;
		}
	}

	return (
		<Workspace
			scroll={scroll}
			empty={runs.length === 0}
			{...(localError ? { error: localError } : {})}
			transcript={runs.map((run) => (
				<RerankRunView
					key={run.id}
					run={run}
					onRetry={() => {
						setQuery(run.query);
						setDraft(run.documents.join("\n"));
					}}
				/>
			))}
			composer={
				<>
					<Documents
						value={draft}
						onChange={setDraft}
						count={documents.length}
						disabled={busy}
					/>
					<Composer
						prompt={query}
						onPrompt={setQuery}
						files={[]}
						onRemove={() => {}}
						onFiles={() => {}}
						placeholder="Ask something to rank them against..."
						showAttach={false}
						accepted={[]}
						reading={false}
						busy={busy}
						onSend={send}
						onStop={() => request.current?.abort()}
						onSettings={() => setSettingsOpen(true)}
						onReset={() => {
							request.current?.abort();
							setRuns([]);
							setQuery("");
							setDraft("");
							setLocalError(undefined);
						}}
						modelPicker={
							<ModelSelect
								models={models}
								capability="rerank"
								modelId={model.id}
								onSelect={onSelect}
							/>
						}
					/>
				</>
			}
		>
			<DialogRoot open={settingsOpen} onOpenChange={setSettingsOpen}>
				<DialogContent layout="sectioned" className="md:w-lg">
					<DialogHeader>
						<DialogTitle>Rerank settings</DialogTitle>
						<DialogDescription>
							Left on Default, the model returns every document it was given.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<NumberField.Root
							value={settings.topN ?? null}
							onValueChange={(value) =>
								setSettings((current) => {
									const next = { ...current };
									if (value === null) delete next.topN;
									else next.topN = value;
									return next;
								})
							}
							min={1}
							max={1000}
							step={1}
						>
							<NumberField.ScrubArea>
								<label
									htmlFor="playground-rerank-top-n"
									className="font-medium text-sm"
								>
									Documents returned
								</label>
							</NumberField.ScrubArea>
							<NumberField.Group>
								<NumberField.Decrement aria-label="Fewer documents" />
								<NumberField.Input
									id="playground-rerank-top-n"
									placeholder="Default"
								/>
								<NumberField.Increment aria-label="More documents" />
							</NumberField.Group>
							<p className="text-fg-muted text-xs">
								The ranking is over all of them either way; this only trims the
								answer.
							</p>
						</NumberField.Root>
					</DialogBody>
					<DialogFooter>
						<DialogClose
							className={buttonStyles({ variant: "primary", size: "sm" })}
						>
							Done
						</DialogClose>
					</DialogFooter>
				</DialogContent>
			</DialogRoot>
		</Workspace>
	);
}
