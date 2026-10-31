import { requireIdentity } from "#/features/auth/identity.ts";
import { AppShell } from "#/features/shell/AppShell.tsx";
import { docsUrl } from "#/shared/config/server.ts";
import { connection } from "next/server";

/**
 * The authenticated half of the dashboard. Every page except the login screen hangs off this layout,
 * so one place decides whether a visitor is in, rather than a guard repeated per page.
 *
 * `requireIdentity()` is called but deliberately **not awaited**: handing the promise down leaves
 * this layout static, which is what lets Next prefetch the shell and paint it on click. Whoever
 * actually needs the operator — the sidebar, a permission gate inside a page — unwraps it behind
 * their own `<Suspense>` boundary. See `features/auth/session.tsx`.
 */
export default function AuthedLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<AppShell docs={documentation()} identity={requireIdentity()}>
			{children}
		</AppShell>
	);
}

/** Read from the environment when a request arrives, never at build time, and not awaited: see above. */
async function documentation(): Promise<string | null> {
	await connection();
	return docsUrl();
}
