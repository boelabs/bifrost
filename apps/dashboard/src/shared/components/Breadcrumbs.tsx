import { PinToggle, RememberVisit } from "#/features/shell/RecentPages";
import { Fragment, Suspense } from "react";
import Link from "next/link";

import {
	BreadcrumbSeparator,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbPage,
	Breadcrumb,
} from "#/components/ui/breadcrumb";

/**
 * The trail back from a record's page, or a creation page, to its list. A record's page passes
 * `recent`, its name in *Recent* and *Pinned*, and the trail ends in the button that pins it to the
 * sidebar.
 */
export function Breadcrumbs({
	items,
	recent,
}: {
	items: Array<{ label: string; href?: string }>;
	recent?: string;
}) {
	return (
		<Breadcrumb>
			{recent ? (
				<Suspense fallback={null}>
					<RememberVisit title={recent} />
				</Suspense>
			) : null}
			<BreadcrumbList>
				{items.map((item, index) => (
					<Fragment key={item.label}>
						{index > 0 ? <BreadcrumbSeparator /> : null}
						<BreadcrumbItem>
							{item.href ? (
								<BreadcrumbLink render={<Link href={item.href} />}>
									{item.label}
								</BreadcrumbLink>
							) : (
								<BreadcrumbPage>{item.label}</BreadcrumbPage>
							)}
						</BreadcrumbItem>
					</Fragment>
				))}
				{recent ? (
					<BreadcrumbItem>
						<Suspense fallback={null}>
							<PinToggle title={recent} />
						</Suspense>
					</BreadcrumbItem>
				) : null}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
