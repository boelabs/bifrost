import Document from "#/components/document.tsx";
import type { Metadata } from "next";

export { viewport } from "#/components/document.tsx";
export const metadata: Metadata = {
	title: { default: "Bifrost", template: "%s · Bifrost" },
	description: "Connect your application to AI providers through one gateway.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
	return <Document locale="en">{children}</Document>;
}
