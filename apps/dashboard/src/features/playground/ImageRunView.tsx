"use client";

import { IconDownload, IconRotate2 } from "@tabler/icons-react";
import { ResponseLoader } from "./ResponseLoader";
import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Status } from "#/components/ui/status";
import type { ImageRun } from "./images";

import {
	MESSAGE_ACTION_ICON,
	MESSAGE_ACTION,
	UserBubble,
} from "./MessageParts";

/** The settings a run was made with, so two runs in the same transcript can be told apart. */
function summary(run: ImageRun): string {
	const { size, quality, n, background, outputFormat, outputCompression } =
		run.settings;
	return [
		run.sources.length ? `edit of ${run.sources.length}` : undefined,
		size,
		quality,
		n !== undefined && n > 1 ? `${n} images` : undefined,
		background,
		outputFormat,
		outputCompression === undefined ? undefined : `${outputCompression}%`,
	]
		.filter(Boolean)
		.join(" · ");
}

function duration(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * One run: what was asked, what came back, and enough of how it was asked to compare it with the
 * run above. The prompt is rendered as the operator's own message, the way the chat does, because
 * this is the same conversation shape with pictures for answers.
 */
export function ImageRunView({
	run,
	onRetry,
}: {
	run: ImageRun;
	onRetry: () => void;
}) {
	const detail = summary(run);
	return (
		<section
			aria-label="Image run"
			className="flex w-full flex-col gap-4 px-4 last:min-h-[calc(var(--transcript-height,0px)-3.5rem)]"
		>
			<article
				aria-label="You message"
				className="group/message ml-auto flex w-full max-w-[90%] flex-col items-end gap-1"
			>
				{run.sources.length ? (
					<div className="flex flex-wrap justify-end gap-2">
						{run.sources.map((source) => (
							// biome-ignore lint/performance/noImgElement: a data: URL, which next/image cannot optimise
							<img
								alt="Source"
								className="size-20 rounded-xl border border-border/60 object-cover"
								key={source}
								src={source}
							/>
						))}
					</div>
				) : null}
				<UserBubble hasAttachments={run.sources.length > 0} text={run.prompt} />
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
				{run.images.length ? (
					<div
						className={`grid gap-3 ${run.images.length > 1 ? "sm:grid-cols-2" : ""}`}
					>
						{run.images.map((image, index) => (
							<figure
								className="group/image relative overflow-hidden rounded-2xl border border-border/60 bg-surface-2"
								key={image.url.slice(-32)}
							>
								{/* biome-ignore lint/performance/noImgElement: a data: URL, which next/image cannot optimise */}
								<img
									alt={`${run.prompt} (${index + 1})`}
									className="block w-full object-contain"
									src={image.url}
								/>
								<a
									aria-label={`Download image ${index + 1}`}
									className="absolute top-2 right-2 inline-flex size-9 items-center justify-center rounded-xl bg-surface/80 text-fg opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover/image:opacity-100"
									download={`image-${index + 1}.${image.mediaType.split("/")[1] ?? "png"}`}
									href={image.url}
									title="Download"
								>
									<IconDownload aria-hidden className="size-4.5" />
								</a>
							</figure>
						))}
					</div>
				) : null}
				{run.revisedPrompt ? (
					<p className="text-fg-muted text-sm">
						<span className="font-medium text-fg">Revised prompt: </span>
						{run.revisedPrompt}
					</p>
				) : null}
				{run.error ? (
					<ErrorNote width="fit-content">{run.error}</ErrorNote>
				) : null}
				<div className="mt-1 -ml-2 flex h-10 shrink-0 items-center gap-0.5 lg:h-8">
					<Button
						aria-label="Generate again"
						className={MESSAGE_ACTION}
						disabled={run.state === "running"}
						mode="icon"
						onClick={onRetry}
						size="sm"
						title="Generate again"
						type="button"
						variant="ghost"
					>
						<IconRotate2 aria-hidden className={MESSAGE_ACTION_ICON} />
					</Button>
					<p className="px-2 text-fg-muted text-xs">
						{[
							run.model,
							detail,
							run.durationMs === undefined
								? undefined
								: duration(run.durationMs),
							run.usage?.totalTokens === undefined
								? undefined
								: `${run.usage.totalTokens.toLocaleString()} tokens`,
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</div>
			</article>
		</section>
	);
}
