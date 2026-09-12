import { ThemeSelect } from "#/shared/theme/ThemeSelect.tsx";
import { SignInForm } from "#/features/auth/SignInForm.tsx";
import { currentSessionIfReachable } from "#/features/auth/api.ts";
import { Card } from "#/components/ui/card";
import { redirect } from "next/navigation";

/**
 * Nobody navigates *to* the login screen from inside the app — they arrive here cold, or get
 * redirected by `src/proxy.ts` after their session expired. There is no click to feel instant, and a
 * loading shell for a form with two inputs would only add a flash, so this segment blocks on its
 * search params rather than streaming.
 */
export const instant = false;

export default async function SignInPage(props: PageProps<"/auth">) {
	// Whether a session is live is the gateway's answer, not the cookie's. `src/proxy.ts` cannot ask
	// — it runs in front of every request — so the one place that sends an already-signed-in operator
	// away from the login screen is here, after a real check. Doing it on cookie presence instead
	// would lock out anyone whose session expired.
	if (await currentSessionIfReachable()) redirect("/");

	const { next } = await props.searchParams;
	// Only same-origin paths. A `next` of `//evil.example` or `https://…` would otherwise turn the
	// login form into an open redirect.
	const target =
		typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
			? next
			: "/";

	return (
		<div className="relative flex min-h-dvh items-center justify-center bg-surface px-4 py-20">
			<div className="absolute top-4 right-4 w-36">
				<ThemeSelect />
			</div>
			<Card className="w-full max-w-sm p-8">
				<div className="pb-6">
					<h1 className="font-semibold text-2xl text-fg tracking-tight">
						Bifrost
					</h1>
					<p className="mt-1 text-fg-muted text-sm">
						Sign in to the operator dashboard.
					</p>
				</div>
				<SignInForm next={target} />
			</Card>
		</div>
	);
}
