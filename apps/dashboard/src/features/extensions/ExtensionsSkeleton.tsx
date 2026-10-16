import { ButtonSkeleton, TableSkeleton } from "#/shared/components/Skeleton";
import { Panel } from "#/shared/components/Panel.tsx";

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

/** The two panels `ExtensionsView` renders, their copy in place and their tables still loading. */
export function ExtensionsSkeleton() {
	return (
		<div
			aria-busy="true"
			aria-label="Loading extensions"
			className="flex flex-col gap-6"
			role="status"
		>
			{panels.map(({ title, description, headers }) => (
				<Panel
					action={
						title === "Instances" ? <ButtonSkeleton label={12} /> : undefined
					}
					description={<span className="block max-w-2xl">{description}</span>}
					key={title}
					title={<h2>{title}</h2>}
				>
					<TableSkeleton headers={headers} pagination plain rows={3} />
				</Panel>
			))}
		</div>
	);
}
