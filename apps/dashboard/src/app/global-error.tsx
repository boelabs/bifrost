"use client";

import { useEffect } from "react";

/**
 * The root layout failed, so React has no document to render into and this one has to supply its own
 * `<html>`. Nothing from `globals.css` is guaranteed to be there either — the failure may be the
 * stylesheet — so the few styles this needs are inline.
 *
 * Reaching this means something broke above every feature. It is deliberately plain.
 */
export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("The dashboard failed to render", error);
	}, [error]);

	return (
		<html lang="en">
			<body
				style={{
					display: "flex",
					minHeight: "100dvh",
					flexDirection: "column",
					alignItems: "center",
					justifyContent: "center",
					gap: "1rem",
					fontFamily: "system-ui, sans-serif",
					textAlign: "center",
				}}
			>
				<h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
					Bifrost could not be displayed
				</h1>
				<p style={{ maxWidth: "32rem", opacity: 0.7 }}>
					Reload the page. If it keeps happening, the dashboard process is
					failing to render — its logs will say why.
				</p>
				<button onClick={reset} type="button">
					Try again
				</button>
				{error.digest ? (
					<p style={{ fontSize: "0.75rem", opacity: 0.6 }}>
						Reference {error.digest}
					</p>
				) : null}
			</body>
		</html>
	);
}
