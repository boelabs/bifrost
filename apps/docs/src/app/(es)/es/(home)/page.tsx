import HomePage from "#/components/home.tsx";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: { absolute: "Bifrost" },
};
export default function Page() {
	return <HomePage locale="es" />;
}
