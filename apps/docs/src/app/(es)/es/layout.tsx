import Document from "#/components/document.tsx";
import type { Metadata } from "next";

export { viewport } from "#/components/document.tsx";
export const metadata: Metadata = {
	manifest: "/es/manifest.webmanifest",
	title: { default: "Bifrost", template: "%s · Bifrost" },
	description:
		"Conecta tu aplicación a proveedores de IA mediante un solo gateway.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
	return <Document locale="es">{children}</Document>;
}
