import Document from "#/components/document.tsx";
import type { Metadata } from "next";

export { viewport } from "#/components/document.tsx";
export const metadata: Metadata = {
	manifest: "/es/manifest.webmanifest",
	title: { default: "Bifrozz", template: "%s · Bifrozz" },
	description:
		"Conecta tu aplicación a proveedores de inteligencia artificial mediante un solo gateway.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
	return <Document locale="es">{children}</Document>;
}
