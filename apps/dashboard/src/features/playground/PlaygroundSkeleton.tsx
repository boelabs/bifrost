"use client";

import { SampleSkeleton } from "#/shared/components/TextSkeleton";
import { GhostSkeleton } from "#/shared/components/Skeleton";
import { PageHeader } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Composer } from "./Composer";

const idle = () => undefined;

export function PlaygroundSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading playground"
			className="flex h-full min-h-0 flex-col"
			role="status"
		>
			<PageHeader
				description="Try your models. Conversations stay in this session."
				title="Playground"
			/>
			<div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
				<div className="min-h-0 flex-1 overflow-hidden pt-6">
					<div className="flex h-full items-center justify-center px-4 pb-8 sm:hidden">
						<h2 className="text-center font-medium text-2xl tracking-tight">
							<SampleSkeleton>Playground</SampleSkeleton>
						</h2>
					</div>
				</div>
				<div className="relative mx-auto w-full shrink-0 px-2 pt-3 pb-2 sm:absolute sm:top-1/2 sm:left-1/2 sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:px-0 sm:pb-4 xl:max-w-3xl">
					<h2 className="mb-6 hidden text-center font-medium text-3xl tracking-tight sm:block">
						<SampleSkeleton>Playground</SampleSkeleton>
					</h2>
					<div aria-hidden inert>
						<GhostSkeleton className="w-full rounded-2xl">
							<Composer
								accepted={[]}
								busy={false}
								files={[]}
								modelPicker={
									<Button disabled size="sm" variant="ghost">
										Public model
									</Button>
								}
								onFiles={idle}
								onPrompt={idle}
								onRemove={idle}
								onReset={idle}
								onSend={idle}
								onSettings={idle}
								onStop={idle}
								prompt=""
								reading={false}
								readOnly
							/>
						</GhostSkeleton>
					</div>
				</div>
			</div>
		</div>
	);
}
