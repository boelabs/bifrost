import DocumentationLayout from "#/components/docs-layout.tsx";
export default function Layout({ children }: { children: React.ReactNode }) {
	return <DocumentationLayout locale="en">{children}</DocumentationLayout>;
}
