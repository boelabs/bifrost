import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import("next").NextConfig} */
const nextConfig = {
	experimental: {
		useTypeScriptCli: true,
	},
	reactStrictMode: true,
};

export default withMDX(nextConfig);
