import { requireIdentity } from "#/features/auth/identity.ts";
import { AppShell } from "#/features/shell/AppShell.tsx";

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
	return <AppShell identity={requireIdentity()}>{children}</AppShell>;
}
