import { HomeLayout } from "fumadocs-ui/layouts/home";
import { homeOptions } from "#/lib/layout.tsx";

/** Everything outside `/docs`: the same header, without the documentation sidebar. */
export default function Layout({ children }: { children: React.ReactNode }) {
	return <HomeLayout {...homeOptions}>{children}</HomeLayout>;
}
