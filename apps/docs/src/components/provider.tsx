"use client";

import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";

const Search = dynamic(() => import("./search.tsx"));

export function Provider({ children }: { children: ReactNode }) {
	return (
		<RootProvider search={{ SearchDialog: Search }}>{children}</RootProvider>
	);
}
