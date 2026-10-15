import { Fragment } from "react";
import Link from "next/link";

import {
	BreadcrumbSeparator,
	BreadcrumbList,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbPage,
	Breadcrumb,
} from "#/components/ui/breadcrumb";

/** The trail back from a record's page, or a creation page, to its list. */
export function Breadcrumbs({
	items,
}: {
	items: Array<{ label: string; href?: string }>;
}) {
	return (
		<Breadcrumb>
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
			</BreadcrumbList>
		</Breadcrumb>
	);
}
