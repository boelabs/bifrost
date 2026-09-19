import { MESSAGE_ACTION, MESSAGE_ACTION_ICON } from "./MessageParts";
import { buttonStyles } from "#/components/ui/button";
import { IconInfoCircle } from "@tabler/icons-react";
import type { ResponseMetrics } from "./transport";
import { cn } from "cn";

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
			{/* Styled as the buttons it sits with, not as a dialog trigger: same box, same hover. */}
			<DialogTrigger
				aria-label="Response details"
				className={cn(
					buttonStyles({ variant: "ghost", size: "sm", mode: "icon" }),
					MESSAGE_ACTION,
				)}
				disabled={disabled}
				title="Response details"
			>
				<IconInfoCircle aria-hidden className={MESSAGE_ACTION_ICON} />
			</DialogTrigger>
			<DialogContent className="md:w-xl" layout="sectioned">
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
				<Metric label="TTFT" unit=" ms" value={metrics.ttftMs} />
				<Metric label="First text" unit=" ms" value={metrics.firstTextMs} />
				<Metric label="Total duration" unit=" ms" value={metrics.durationMs} />
				<Metric
					label="Text streaming"
					unit=" ms"
					value={metrics.textDurationMs}
				/>
				<Metric
					label="Text speed (est.)"
					unit=" tok/s"
					value={metrics.outputTokensPerSecond}
				/>
				<Metric
					label="Request average"
					unit=" tok/s"
					value={metrics.requestTokensPerSecond}
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
				<p className="wrap-break-word text-warning text-xs" key={warning}>
					{warning}
				</p>
			))}{" "}
		</div>
	);
}
