"use client";

import { ErrorNote } from "#/components/ui/page";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { useRouter } from "next/navigation";
import { Form } from "#/components/ui/form";
import { login } from "./browser.ts";
import { useState } from "react";

/**
 * `next` comes from the page, which read it out of the URL — the same value `src/proxy.ts` put there
 * when it turned an unauthenticated visit into a redirect. Only same-origin paths are honoured; the
 * page has already rejected anything else.
 */
export function SignInForm({ next }: { next: string }) {
	const router = useRouter();
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setPending(true);
		const form = new FormData(event.currentTarget);
		try {
			await login(String(form.get("username")), String(form.get("password")));
			// The gateway's Set-Cookie has landed by now, so the next request to this app carries the
			// session. `refresh()` is what makes the Server Components re-read it.
			router.replace(next);
			router.refresh();
		} catch (cause) {
			// The gateway answers every rejected login identically, on purpose: nothing here should
			// hint at whether the account exists.
			setError(cause instanceof Error ? cause.message : "Sign in failed.");
			setPending(false);
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
