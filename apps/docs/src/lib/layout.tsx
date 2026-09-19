import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import Image from "next/image";

/**
 * Chrome shared by the documentation and the landing page, so the header never shifts between them.
 *
 * `githubUrl` is Fumadocs' own shortcut: it renders the icon link, the repository shortcut in the
 * mobile menu, and the "Edit on GitHub" affordance from one value.
 */
export const baseOptions: BaseLayoutProps = {
	githubUrl: "https://github.com/boelabs/bifrost",
	nav: {
		title: (
			<>
				<Image
					alt=""
					// The mark is one colour on transparent, so the theme is a filter rather than a
					// second file: black ink as drawn, flipped to white on a dark background.
					className="dark:invert"
					height={17}
					src="/logo.svg"
					width={26}
				/>
				<span className="font-medium">Bifrost</span>
			</>
		),
	},
};

/**
 * The landing page adds the two ways in.
 *
 * They are deliberately *not* on the documentation layout: there they render inside the sidebar,
 * directly above the switcher that already moves between exactly these two sections — the same
 * choice offered twice, one of them without the section's contents.
 */
export const homeOptions: BaseLayoutProps = {
	...baseOptions,
	links: [
		{ text: "Docs", url: "/docs", active: "nested-url" },
		{ text: "API", url: "/docs/api-overview", active: "nested-url" },
	],
};
