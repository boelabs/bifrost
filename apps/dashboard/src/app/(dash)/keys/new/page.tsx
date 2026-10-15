import { KeyForm, KeyFormSkeleton } from "#/features/keys/KeyForm.tsx";
import { Breadcrumbs } from "#/shared/components/Breadcrumbs.tsx";
import { publicModelNames } from "#/features/deployments/api.ts";
import { PageHeader } from "#/components/ui/page";
import { Suspense } from "react";

/**
 * A new virtual key, on its own page.
 *
 * The model suggestions are started here but never awaited: only the allowed-models field unwraps
 * them, so the form is on screen before the deployments are read.
 */
export default function NewKeyPage() {
	return (
		<>
			<Breadcrumbs
				items={[{ label: "API keys", href: "/keys" }, { label: "New" }]}
			/>
			<PageHeader
				description="Scope the key to the models a client may call, and give it limits it cannot exceed."
				title="New API key"
			/>
			<Suspense fallback={<KeyFormSkeleton />}>
				<KeyForm models={publicModelNames()} />
			</Suspense>
		</>
	);
}
