import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/app/layout.config";
import Link from "next/link";

export default function NotFound() {
	return (
		<HomeLayout {...baseOptions}>
			<div className="unified-not-found">
				<p className="unified-eyebrow">404</p>
				<h1>Page not found</h1>
				<p>The route does not exist in the Bifrost documentation tree.</p>
				<Link className="unified-button unified-button-primary" href="/docs">
					Open docs
				</Link>
			</div>
		</HomeLayout>
	);
}
