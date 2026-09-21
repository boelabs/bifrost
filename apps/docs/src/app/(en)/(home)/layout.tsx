import { HomeLayout } from "fumadocs-ui/layouts/home";
import { getHomeOptions } from "#/lib/layout.tsx";

export default function Layout({ children }: { children: React.ReactNode }) {
	return <HomeLayout {...getHomeOptions("en")}>{children}</HomeLayout>;
}
