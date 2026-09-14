import { Google_Sans_Code, Google_Sans_Flex } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata, Viewport } from "next";

import "./global.css";

/**
 * The same two families the dashboard uses, so an operator moving between the docs and the product
 * does not cross a typographic seam. `next/font` self-hosts them and emits the `@font-face` rules,
 * which is why there is no font CSS in this repository.
 */
const sans = Google_Sans_Flex({
	subsets: ["latin"],
	variable: "--font-sans",
	display: "swap",
	fallback: ["system-ui", "sans-serif"],
	// Both families are recent enough that Next has no width metrics for them, so it cannot compute
	// a size-adjusted fallback face. Saying so explicitly keeps the build quiet about a fallback we
	// are not getting, and the stacks above are what actually renders until the font arrives.
	adjustFontFallback: false,
});
const mono = Google_Sans_Code({
	subsets: ["latin"],
	variable: "--font-mono",
	display: "swap",
	fallback: ["ui-monospace", "monospace"],
	adjustFontFallback: false,
});

export const metadata: Metadata = {
	title: {
		default: "Bifrost",
		template: "%s · Bifrost",
	},
	description:
		"Bifrost by Boelabs: a provider-agnostic AI gateway with OpenAI and Anthropic-compatible APIs.",
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

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		// `suppressHydrationWarning` is required by the theme provider, which writes the resolved
		// theme onto <html> before React hydrates so the first paint is never the wrong one.
		<html
			lang="en"
			className={`${sans.variable} ${mono.variable}`}
			suppressHydrationWarning
		>
			<body className="flex min-h-screen flex-col">
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	);
}
