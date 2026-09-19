"use client";

import { MESSAGE_ACTION, MESSAGE_ACTION_ICON } from "./MessageParts";
import { cosineSimilarity, type EmbeddingRun } from "./embeddings";
import { ResponseLoader } from "./ResponseLoader";
import { IconRotate2 } from "@tabler/icons-react";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import { CopyAction } from "./MessageParts";

function duration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/** The first few components, which is all a vector can usefully show of itself. */
function preview(vector: number[]): string {
	return `[${vector
		.slice(0, 6)
		.map((value) => value.toFixed(4))
		.join(", ")}${vector.length > 6 ? ", …" : ""}]`;
}

/**
 * How alike the gateway thinks these texts are.
 *
 * Cosine similarity is the question an embedding is usually run to answer, and it is the one thing
 * that cannot be read off the numbers by eye. Shown only for a batch, because a single vector has
 * nothing to be similar to.
 */
function Similarity({ vectors }: { vectors: number[][] }) {
	return (
		<div className="overflow-x-auto">
			<table className="border-collapse text-sm">
				<caption className="pb-2 text-left text-fg-muted text-xs">
					Cosine similarity
				</caption>
				<thead>
					<tr>
						<th className="p-1" />
						{vectors.map((_, column) => (
							<th
								className="px-2 py-1 text-fg-muted text-xs"
								// biome-ignore lint/suspicious/noArrayIndexKey: position is the identity of an input here
								key={column}
								scope="col"
							>
								{column + 1}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{vectors.map((row, rowIndex) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: position is the identity of an input here
						<tr key={rowIndex}>
							<th className="px-2 py-1 text-fg-muted text-xs" scope="row">
								{rowIndex + 1}
							</th>
							{vectors.map((column, columnIndex) => {
								const value = cosineSimilarity(row, column);
								return (
									<td
										className="px-2 py-1 text-center font-mono text-xs"
										// biome-ignore lint/suspicious/noArrayIndexKey: position is the identity of an input here
										key={columnIndex}
										style={{
											// The number is the content; the wash is only a reading aid.
											backgroundColor:
												value === undefined
													? undefined
													: `color-mix(in oklab, var(--color-primary) ${Math.max(0, value) * 45}%, transparent)`,
										}}
									>
										{value === undefined ? "—" : value.toFixed(3)}
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

export function EmbeddingRunView({
	run,
	onCopy,
	onRetry,
}: {
	run: EmbeddingRun;
	onCopy: (text: string) => Promise<void>;
	onRetry: () => void;
}) {
	const dimensions = run.vectors[0]?.length;
	return (
		<section
			aria-label="Embedding run"
			className="flex w-full flex-col gap-4 px-4 last:min-h-[calc(var(--transcript-height,0px)-3.5rem)]"
		>
			<article
				aria-label="You message"
				className="ml-auto flex w-full max-w-[90%] flex-col items-end gap-1.5"
			>
				{run.inputs.map((input, index) => (
					<div
						className="flex max-w-full items-start gap-2"
						// biome-ignore lint/suspicious/noArrayIndexKey: the position is what the results are numbered by
						key={index}
					>
						<span className="mt-2 text-fg-muted text-xs">{index + 1}</span>
						<p className="wrap-break-word wrap-anywhere w-fit max-w-full overflow-hidden rounded-3xl border border-border/60 bg-surface-2 px-3.5 py-2.5 text-base leading-6">
							{input}
						</p>
					</div>
				))}
			</article>
			<article
				aria-label="Assistant message"
				className="flex w-full min-w-0 flex-col gap-3"
			>
				{run.state === "running" ? <ResponseLoader /> : null}
				{run.state === "stopped" ? (
					<div className="text-fg-muted text-xs">
						<Status tone="muted">Stopped</Status>
					</div>
				) : null}
				{run.vectors.length ? (
					<>
						<ul className="flex flex-col gap-1.5">
							{run.vectors.map((vector, index) => (
								<li
									className="flex min-w-0 items-center gap-2"
									// biome-ignore lint/suspicious/noArrayIndexKey: position matches the input above
									key={index}
								>
									<span className="text-fg-muted text-xs">{index + 1}</span>
									<code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2 py-1 font-mono text-xs">
										{preview(vector)}
									</code>
									<CopyAction
										label={`Copy vector ${index + 1}`}
										onCopy={onCopy}
										text={JSON.stringify(vector)}
									/>
								</li>
							))}
						</ul>
						{run.vectors.length > 1 ? (
							<Similarity vectors={run.vectors} />
						) : null}
					</>
				) : null}
				{run.error ? (
					<ErrorNote width="fit-content">{run.error}</ErrorNote>
				) : null}
				<div className="-ml-2 flex h-10 shrink-0 items-center gap-0.5 lg:h-8">
					<Button
						aria-label="Embed again"
						className={MESSAGE_ACTION}
						disabled={run.state === "running"}
						mode="icon"
						onClick={onRetry}
						size="sm"
						title="Embed again"
						type="button"
						variant="ghost"
					>
						<IconRotate2 aria-hidden className={MESSAGE_ACTION_ICON} />
					</Button>
					<p className="px-2 text-fg-muted text-xs">
						{[
							run.model,
							dimensions === undefined
								? undefined
								: `${dimensions.toLocaleString()} dimensions`,
							run.settings.encodingFormat,
							run.durationMs === undefined
								? undefined
								: duration(run.durationMs),
							run.totalTokens === undefined
								? undefined
								: `${run.totalTokens.toLocaleString()} tokens`,
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</div>
			</article>
		</section>
	);
}
