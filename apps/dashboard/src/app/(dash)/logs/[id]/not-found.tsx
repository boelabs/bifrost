import { Breadcrumbs } from "#/shared/components/Breadcrumbs.tsx";
import { EmptyState } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import Link from "next/link";

/** A link to an operation retention has since removed, or to one that never existed. */
export default function LogNotFound() {
	return (
		<>
			<Breadcrumbs items={[{ label: "Logs", href: "/logs" }]} />
			<EmptyState
				description="It may have passed the retention window, or the link is incomplete."
				title="Operation not found"
			>
				<Button
					nativeButton={false}
					render={<Link href="/logs" />}
					variant="secondary"
				>
					Back to logs
				</Button>
			</EmptyState>
		</>
	);
}
