import { ButtonSkeleton, TableSkeleton } from "#/shared/components/Skeleton";
import { SampleSkeleton } from "#/shared/components/TextSkeleton";
import { ContentPanel } from "#/components/ui/card";

const panels = [
	{
		title: "Instances",
		description:
			"One definition running with one configuration. Status is read from the replica answering this page — a breaker trip disables an instance there, not in the database, so another replica may still be running it.",
		headers: ["Instance", "Definition", "In this replica", "Priority", ""],
	},
	{
		title: "Code",
		description:
			"Uploaded modules, versioned. Uploading the same key adds a version and activates it; older versions stay and can be activated again.",
		headers: ["Key", "Active version", "Size", "Uploaded by", ""],
	},
];

export function ExtensionsSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading extensions"
			className="flex flex-col gap-6"
			role="status"
		>
			{panels.map(({ title, description, headers }) => (
				<ContentPanel className="min-w-0 p-0" key={title}>
					<div className="p-5">
						<div className="flex flex-wrap items-start justify-between gap-3 pb-4">
							<div>
								<h2 className="font-semibold">
									<SampleSkeleton>{title}</SampleSkeleton>
								</h2>
								<p className="max-w-2xl pt-1 text-muted-foreground text-sm">
									<SampleSkeleton>{description}</SampleSkeleton>
								</p>
							</div>
							{title === "Instances" ? <ButtonSkeleton label={12} /> : null}
						</div>
						<TableSkeleton
							headers={headers}
							pagination
							plain={title === "Instances"}
							rows={3}
						/>
					</div>
				</ContentPanel>
			))}
		</div>
	);
}
