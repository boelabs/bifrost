"use client";

import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { useState, useTransition } from "react";
import { leaveFor, login } from "./browser.ts";
import { Input } from "#/components/ui/input";
import { Form } from "#/components/ui/form";

/**
 * `next` comes from the page, which read it out of the URL — the same value `src/proxy.ts` put there
 * when it turned an unauthenticated visit into a redirect. Only same-origin paths are honoured; the
 * page has already rejected anything else.
 */
export function SignInForm({ next }: { next: string }) {
	const [error, setError] = useState<string | null>(null);
	/**
	 * Signing in is a transition, not a flag that is set and never cleared. The form is not
	 * necessarily gone once it is submitted — a rejected password leaves the operator right here —
	 * and a `pending` that only the success path clears is one edit away from sticking.
	 */
	const [pending, startSigningIn] = useTransition();

	function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		const form = new FormData(event.currentTarget);
		startSigningIn(async () => {
			try {
				await login(String(form.get("username")), String(form.get("password")));
			} catch (cause) {
				// The gateway answers every rejected login identically, on purpose: nothing here
				// should hint at whether the account exists.
				setError(cause instanceof Error ? cause.message : "Sign in failed.");
				return;
			}
			// The gateway's Set-Cookie has landed, so the document this asks for carries the session.
			// It never comes back — see `leaveFor` for why a session boundary is a document load.
			await leaveFor(next);
		});
	}

	return (
		<Form className="flex flex-col gap-4" onSubmit={onSubmit}>
			<Input
				autoComplete="username"
				autoFocus
				label="Username"
				name="username"
				required
			/>
			<Input
				autoComplete="current-password"
				label="Password"
				name="password"
				required
				type="password"
			/>
			{error ? <ErrorNote>{error}</ErrorNote> : null}
			<Button className="mt-2 w-full" disabled={pending} type="submit">
				{pending ? "Signing in…" : "Sign in"}
			</Button>
		</Form>
	);
}
