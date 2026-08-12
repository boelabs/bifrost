import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export const baseOptions: BaseLayoutProps = {
	githubUrl: "https://github.com/boelabs/bifrost",
	nav: {
		title: (
			<>
				<span className="unified-nav-logo" aria-hidden="true" />
				<span>Bifrost</span>
			</>
		),
		url: "/",
	},
};
