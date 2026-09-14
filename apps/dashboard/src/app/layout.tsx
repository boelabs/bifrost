import { NotificationProvider } from "#/shared/feedback/notifications.tsx";
import { ThemeProvider } from "#/shared/theme/ThemeProvider.tsx";
import { ConfirmProvider } from "#/shared/feedback/confirm.tsx";
import { themeScript } from "#/shared/theme/theme.ts";
import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
	title: "Bifrost",
	description: "Operator dashboard for the Bifrost AI gateway.",
	icons: {
		icon: [
			{ url: "/favicon.svg", type: "image/svg+xml" },
			{ url: "/favicon.ico", sizes: "any" },
		],
		apple: "/apple-touch-icon.png",
	},
	manifest: "/site.webmanifest",
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
};

/**
 * The face that carries the interface on a first paint. `font-display: optional` means a face that
 * has not arrived by then is skipped rather than swapped in late, so without this the first visit
 * would render entirely in the system fallback.
 *
 * Only the sans face. The monospace one is preloaded nowhere because most pages never draw a
 * monospace glyph — `unicode-range` keeps the browser from requesting it at all — so preloading it
 * globally is one wasted request per page load, which the browser reports as a preload that went
 * unused. Everything else in `shared/fonts/fonts.css` loads on demand, per script.
 */
const PRELOADED_FONTS = ["/fonts/google-sans-flex-latin-normal.woff2"];

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				{PRELOADED_FONTS.map((href) => (
					<link
						key={href}
						rel="preload"
						href={href}
						as="font"
						type="font/woff2"
						crossOrigin="anonymous"
					/>
				))}
				{/*
				 * Runs before the first paint so the stored preference is on <html> by the time any
				 * pixel is drawn. A theme applied from an effect flashes the wrong one first, and this
				 * document is streamed, so there is no server render of the choice to rely on.
				 */}
				{/* biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed literal, no interpolation */}
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body>
				<ThemeProvider>
					<NotificationProvider>
						<ConfirmProvider>{children}</ConfirmProvider>
					</NotificationProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}
