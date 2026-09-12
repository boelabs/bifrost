import { createMDX } from "fumadocs-mdx/next";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
	experimental: {
		// TypeScript 7 no longer exposes the compiler API Next's legacy worker expects. Delegate to
		// the same CLI `typecheck` uses, so local, CI and build validation agree.
		useTypeScriptCli: true,
	},

	/**
	 * The site is a build-time artifact: every page comes from MDX in this repository and nothing is
	 * per-visitor, so all of it prerenders and the running server only hands out what the build
	 * produced. The one exception is `/api/search`, which queries the search index in process.
	 */
	output: "standalone",
	outputFileTracingRoot: join(here, "../.."),
};

export default createMDX()(nextConfig);
