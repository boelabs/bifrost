import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import type { Metadata } from "next";

import "./global.css";

export const metadata: Metadata = {
	title: {
		default: "Bifrost",
		template: "%s | Bifrost",
	},
	description:
		"Provider-agnostic AI gateway infrastructure with an exact OpenAI-compatible contract.",
	icons: {
		icon: "/favicon.svg",
	},
	metadataBase: new URL("https://boelabs.github.io"),
};

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
			className="scrollbar-gutter-stable"
		>
			<body>
				<RootProvider
					search={{
						options: {
							api: "/api/search",
						},
					}}
					theme={{
						attribute: "class",
						defaultTheme: "system",
						enableSystem: true,
					}}
				>
					{children}
				</RootProvider>
			</body>
		</html>
	);
}
