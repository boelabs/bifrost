import { TextSkeleton } from "#/shared/components/TextSkeleton.tsx";
import { PageHeader } from "#/components/ui/page";
import { Status } from "#/components/ui/status";
import { KeyFormSkeleton } from "./KeyForm.tsx";
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
} from "#/shared/components/Skeleton.tsx";

/**
 * A key's page while the key is found: the trail back to the list, the header with its name, status
 * and actions, and the form, all at their real sizes.
 */
export function KeyPageSkeleton() {
	return (
		<>
			<Breadcrumb>
				<BreadcrumbList>
					<BreadcrumbItem>
						<BreadcrumbLink render={<Link href="/keys" />}>
							API keys
						</BreadcrumbLink>
					</BreadcrumbItem>
					<BreadcrumbSeparator />
					<BreadcrumbItem>
						<BreadcrumbPage>
							<TextSkeleton length={12} />
						</BreadcrumbPage>
					</BreadcrumbItem>
				</BreadcrumbList>
			</Breadcrumb>
			<PageHeader
				actions={
					<>
						<ButtonSkeleton label={6} size="md" />
						<ButtonSkeleton label={7} size="md" />
						<ButtonSkeleton label={10} size="md" />
						<ButtonSkeleton label={8} size="md" />
					</>
				}
				badge={
					<GhostSkeleton className="rounded-sm">
						<Status>Enabled</Status>
					</GhostSkeleton>
				}
				description={<TextSkeleton length={12} />}
				title={<TextSkeleton length={16} />}
			/>
			<KeyFormSkeleton editing />
		</>
	);
}
