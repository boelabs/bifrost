"use client";

import { createContext, useCallback, useMemo, use } from "react";
import type { OperatorIdentity, Permission } from "./common.ts";
import { useRouter } from "next/navigation";
import { logout } from "./browser.ts";

interface SessionValue {
	identity: OperatorIdentity;
	/** True when the role grants every listed permission. */
	can: (...permissions: Permission[]) => boolean;
	signOut: () => Promise<void>;
	/** Re-runs the Server Components on this page, which re-reads the identity with them. */
	refresh: () => void;
}

/**
 * The identity travels as a *promise*, not a value.
 *
 * `app/(dash)/layout.tsx` starts the request and hands the promise down without awaiting it, so the
 * shell — sidebar frame, header, main column — belongs to the App Shell and paints the moment a link
 * is clicked. Each consumer unwraps it with `use()`, which suspends that consumer alone, inside
 * whatever `<Suspense>` boundary it already sits in. Awaiting it in the layout instead would hold
 * every page in the dashboard behind one session request.
 */
const SessionContext = createContext<Promise<OperatorIdentity> | null>(null);

export function SessionProvider({
	identity,
	children,
}: {
	identity: Promise<OperatorIdentity>;
	children: React.ReactNode;
}) {
	return <SessionContext value={identity}>{children}</SessionContext>;
}

/** Only valid inside the authenticated layout, which is what provides the promise. */
export function useSession(): SessionValue {
	const promise = use(SessionContext);
	if (!promise)
		throw new Error("useSession must be used inside the authenticated layout");
	const identity = use(promise);
	const router = useRouter();

	/**
	 * Signing out leaves by loading a document, not by asking the router to navigate.
	 *
	 * `router.replace()` would keep the tab: the router holds on to the tree it navigated away from
	 * and shows it again, React state and all, the moment this tab is signed in once more. What
	 * `refresh()` drops is the *server's* half — every Server Component re-runs — while the operator's
	 * client state rides through the sign-out untouched: the filters they typed, a dialog they left
	 * open, a playground conversation. A session boundary is exactly where none of that should
	 * survive, and a document load is the only thing that guarantees it.
	 *
	 * The cookie is gone by then, so `src/proxy.ts` decides where the new document goes.
	 */
	const signOut = useCallback(async () => {
		await logout();
		window.location.replace("/auth");
	}, []);

	const refresh = useCallback(() => router.refresh(), [router]);

	return useMemo<SessionValue>(() => {
		const granted = new Set(identity.permissions);
		return {
			identity,
			can: (...permissions) => permissions.every((p) => granted.has(p)),
			signOut,
			refresh,
		};
	}, [identity, signOut, refresh]);
}

/**
 * Renders children only when the role allows it. Permissions are enforced by the gateway; this exists
 * so the UI does not offer actions that would come back 403.
 */
export function Can({
	permissions,
	fallback = null,
	children,
}: {
	permissions: Permission[];
	fallback?: React.ReactNode;
	children: React.ReactNode;
}) {
	const { can } = useSession();
	return can(...permissions) ? children : fallback;
}
