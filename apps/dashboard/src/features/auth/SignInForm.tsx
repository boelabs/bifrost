"use client";

import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Form } from "#/components/ui/form";
import { login } from "./browser.ts";

/**
 * `next` comes from the page, which read it out of the URL — the same value `src/proxy.ts` put there
 * when it turned an unauthenticated visit into a redirect. Only same-origin paths are honoured; the
 * page has already rejected anything else.
 */
export function SignInForm({ next }: { next: string }) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [signingIn, setSigningIn] = useState(false);
	/**
	 * The navigation away from this form is a transition, not a flag that is set and never cleared.
	 *
	 * Signing in does not unmount this screen for good: the router keeps the tree it navigated away
	 * from, and shows that same tree again — React state and all — when an expired session sends the
	 * operator back here without a document load. A `pending` boolean left `true` because "the page
	 * is leaving anyway" comes back with it, and the button they need is disabled with no way out
	 * but a reload. `useTransition` cannot get stuck that way: it is false again the moment the
	 * navigation commits.
	 */
	const [navigating, startNavigating] = useTransition();
	const pending = signingIn || navigating;

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setSigningIn(true);
		const form = new FormData(event.currentTarget);
		try {
			await login(String(form.get("username")), String(form.get("password")));
			startNavigating(() => {
				// Cleared inside the transition, so the button stays "Signing in…" until the next
				// screen is on the page rather than flicking back for the length of the navigation.
				setSigningIn(false);
				// The gateway's Set-Cookie has landed by now, so the next request to this app carries
				// the session. `refresh()` is what makes the Server Components re-read it.
				router.replace(next);
				router.refresh();
			});
		} catch (cause) {
			// The gateway answers every rejected login identically, on purpose: nothing here should
			// hint at whether the account exists.
			setError(cause instanceof Error ? cause.message : "Sign in failed.");
			setSigningIn(false);
		}
	}

	return (
		<Form onSubmit={onSubmit} className="flex flex-col gap-4">
			<Input
				name="username"
				label="Username"
				autoComplete="username"
				autoFocus
				required
			/>
			<Input
				name="password"
				label="Password"
				type="password"
				autoComplete="current-password"
				required
			/>
			{error ? <ErrorNote>{error}</ErrorNote> : null}
			<Button type="submit" disabled={pending} className="mt-2 w-full">
				{pending ? "Signing in…" : "Sign in"}
			</Button>
		</Form>
	);
}
