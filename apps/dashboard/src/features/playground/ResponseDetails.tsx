import { buttonStyles } from "#/components/ui/button";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ResponseMetrics } from "./transport";

import {
	DialogDescription,
	DialogTrigger,
	DialogContent,
	DialogHeader,
	DialogFooter,
	DialogTitle,
	DialogClose,
	DialogRoot,
	DialogBody,
} from "#/components/ui/dialog";

export function ResponseDetails({
	metrics,
	disabled = false,
}: {
	metrics: ResponseMetrics;
	disabled?: boolean;
}) {
	return (
		<DialogRoot>
			<DialogTrigger
				disabled={disabled}
				className="size-10 rounded-xl p-0 text-fg-muted lg:size-8"
				aria-label="Response details"
				title="Response details"
			>
				<IconInfoCircle className="size-5 lg:size-4.5" aria-hidden />
			</DialogTrigger>
			<DialogContent layout="sectioned" className="md:w-xl">
				<DialogHeader>
					<DialogTitle>Response details</DialogTitle>
					<DialogDescription>
						Timing and token usage for this response.
					</DialogDescription>
				</DialogHeader>
				<DialogBody>
					<Metrics metrics={metrics} />
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
	);
}

function Metric({
	label,
	value,
	unit = "",
}: {
	label: string;
	value?: number;
	unit?: string;
}) {
	return (
		<div>
			<dt className="text-fg-muted">{label}</dt>
			<dd className="font-mono text-fg">
				{value === undefined
					? "Unavailable"
					: `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${unit}`}
			</dd>
		</div>
	);
}

export function Metrics({ metrics }: { metrics: ResponseMetrics }) {
	return (
		<div className="space-y-4">
			<dl className="grid grid-cols-2 gap-x-5 gap-y-2 text-sm sm:grid-cols-3">
				<Metric label="TTFT" value={metrics.ttftMs} unit=" ms" />
				<Metric label="First text" value={metrics.firstTextMs} unit=" ms" />
				<Metric label="Total duration" value={metrics.durationMs} unit=" ms" />
				<Metric
					label="Text streaming"
					value={metrics.textDurationMs}
					unit=" ms"
				/>
				<Metric
					label="Text speed (est.)"
					value={metrics.outputTokensPerSecond}
					unit=" tok/s"
				/>
				<Metric
					label="Request average"
					value={metrics.requestTokensPerSecond}
					unit=" tok/s"
				/>
				<Metric label="Input tokens" value={metrics.inputTokens} />
				<Metric label="Output tokens" value={metrics.outputTokens} />
				<Metric label="Total tokens" value={metrics.totalTokens} />
				<Metric label="Reasoning tokens" value={metrics.reasoningTokens} />
				<Metric label="Cached input" value={metrics.cachedInputTokens} />
			</dl>
			<p className="text-fg-muted text-xs leading-5">
				Text speed excludes the initial wait, reported reasoning tokens and the
				final stream closure. It is estimated between the first and last text
				chunks; buffered delivery can distort it. Request average includes the
				entire request and all output tokens.
			</p>
			{metrics.outputTokensPerSecond === undefined ? (
				<p className="text-fg-muted text-xs">
					Text speed needs multiple timed text chunks and sufficient token usage
					details.
				</p>
			) : null}
			{metrics.finishReason ? (
				<p className="text-fg-muted text-xs">
					Finish reason: {metrics.finishReason}
				</p>
			) : null}
			{metrics.warnings?.map((warning) => (
				<p key={warning} className="break-words text-warning text-xs">
					{warning}
				</p>
			))}{" "}
		</div>
	);
}
