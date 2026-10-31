import { KeyHeaderActions } from "#/features/keys/KeyHeaderActions.tsx";
import { RouteBoundary } from "#/shared/components/RouteBoundary.tsx";
import { KeyPageSkeleton } from "#/features/keys/KeySkeleton.tsx";
import { Breadcrumbs } from "#/shared/components/Breadcrumbs.tsx";
import { publicModelNames } from "#/features/deployments/api.ts";
import { KeyForm } from "#/features/keys/KeyForm.tsx";
import { PageHeader } from "#/components/ui/page";
import { getKey } from "#/features/keys/api.ts";
import { Status } from "#/components/ui/status";
import { notFound } from "next/navigation";
import { Suspense } from "react";

type Params = PageProps<"/keys/[key]">["params"];

/** Keys are identified by a UUID; anything else is not a key, and is not looked for. */
const KEY_ID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One virtual key: its name, status and actions in the header, and the same form that created it.
 *
 * Everything on the page names the key, so all of it waits on the one lookup behind one boundary.
 */
export default function KeyPage(props: PageProps<"/keys/[key]">) {
	return (
		<RouteBoundary title="The key could not be loaded">
			<Suspense fallback={<KeyPageSkeleton />}>
				<KeyDetail params={props.params} />
			</Suspense>
		</RouteBoundary>
	);
}

async function KeyDetail({ params }: { params: Params }) {
	const { key: id } = await params;
	const apiKey = KEY_ID.test(id) ? await getKey(id) : null;
	if (!apiKey) {
		notFound();
	}
	return (
		<>
			<Breadcrumbs
				items={[{ label: "API keys", href: "/keys" }, { label: apiKey.name }]}
				recent={apiKey.name}
			/>
			<PageHeader
				actions={<KeyHeaderActions apiKey={apiKey} />}
				badge={
					<Status tone={apiKey.enabled ? "success" : "muted"}>
						{apiKey.enabled ? "Enabled" : "Disabled"}
					</Status>
				}
				description={<span className="font-mono">{apiKey.keyPrefix}…</span>}
				title={apiKey.name}
			/>
			{/* Remount per key: the form is seeded from the key it opened on. */}
			<KeyForm existing={apiKey} key={apiKey.id} models={publicModelNames()} />
		</>
	);
}
