import { DetailLayout } from "#/shared/components/DetailLayout.tsx";
import { DetailList } from "#/shared/components/DetailList.tsx";
import { Panel } from "#/shared/components/Panel.tsx";
import { PageHeader } from "#/components/ui/page";
import { Status } from "#/components/ui/status";
import Link from "next/link";

import {
	BreadcrumbSeparator,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbPage,
	Breadcrumb,
} from "#/components/ui/breadcrumb";

import {
	ButtonSkeleton,
	GhostSkeleton,
	Skeleton,
} from "#/shared/components/Skeleton.tsx";

import {
	SampleSkeleton,
	TextSkeleton,
} from "#/shared/components/TextSkeleton.tsx";

const UUID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

/** A row's value while it loads, as long as the usual one. */
function value(length: number) {
	return <TextSkeleton length={length} />;
}

/**
 * The operation's page while the gateway answers: the same breadcrumb, header, panels and lists,
 * with one attempt (most requests make exactly one) and the payload not yet revealed.
 */
export function LogDetailSkeleton() {
	return (
		<>
			<Breadcrumb aria-busy="true">
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink render={<Link href="/logs" />}>Logs</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>
							<TextSkeleton length={8} />
						</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
			<PageHeader
				badge={
					<GhostSkeleton className="rounded-sm">
						<Status tone="success">success</Status>
					</GhostSkeleton>
				}
				description={<TextSkeleton length={34} />}
				title={<TextSkeleton length={18} />}
			/>
			<DetailLayout
				aside={
					<>
						<Panel title="Summary">
							<DetailList
								items={[
									{
										label: "Operation ID",
										value: (
											<span className="flex items-center gap-1 font-mono text-xs">
												<SampleSkeleton>{UUID}</SampleSkeleton>
											</span>
										),
									},
									{
										label: "Request ID",
										value: (
											<span className="flex items-center gap-1 font-mono text-xs">
												<SampleSkeleton>{UUID}</SampleSkeleton>
											</span>
										),
									},
									{ label: "Public model", value: value(14) },
									{ label: "Call type", value: value(16) },
									{ label: "Started", value: value(20) },
								]}
							/>
						</Panel>
						<Panel title="Timing">
							<DetailList
								items={[
									{ label: "Duration", value: value(6) },
									{ label: "First output", value: value(6) },
									{ label: "Finish", value: value(4) },
									{ label: "Attempts", value: value(1) },
								]}
							/>
						</Panel>
						<Panel title="Usage">
							<DetailList
								items={[
									{ label: "Tokens", value: value(5) },
									{ label: "Cost", value: value(9) },
								]}
							/>
						</Panel>
					</>
				}
			>
				<Panel
					description={<TextSkeleton length={88} />}
					title={<SampleSkeleton>Attempts (1)</SampleSkeleton>}
				>
					<div aria-hidden="true" className="flex flex-col gap-3">
						<div className="flex flex-wrap items-center gap-2 text-sm">
							<TextSkeleton length={2} />
							<GhostSkeleton className="rounded-sm">
								<Status tone="success">success</Status>
							</GhostSkeleton>
							<TextSkeleton length={14} />
							<span className="font-mono text-xs">
								<TextSkeleton length={28} />
							</span>
							<span className="ml-auto text-xs">
								<TextSkeleton length={6} />
							</span>
						</div>
						<Skeleton className="h-2 rounded-full" width="100%" />
						<dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
							{["Headers", "First output", "Upstream bytes", "Tokens"].map(
								(label) => (
									<div className="flex min-w-0 flex-col" key={label}>
										<dt className="text-fg-muted text-xs">{label}</dt>
										<dd className="text-sm">
											<TextSkeleton length={6} />
										</dd>
									</div>
								),
							)}
						</dl>
					</div>
				</Panel>
				<Panel action={<ButtonSkeleton label={14} />} title="Retained payload">
					<p className="text-muted-foreground text-sm">
						<TextSkeleton length={110} />
					</p>
				</Panel>
			</DetailLayout>
		</>
	);
}
