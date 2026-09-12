import { cp } from "node:fs/promises";

/**
 * Serves the production build the way the image does: Next's standalone server, under Bun.
 *
 * `next build` writes the traced server to `.next/standalone` but leaves two things beside it — the
 * hashed client chunks in `.next/static` and everything in `public/` — so they are copied in first.
 * The Dockerfile performs exactly these three steps; keeping them here means `bun run start`
 * reproduces the container rather than approximating it with `next start`, which does not work with
 * `output: "standalone"` at all.
 *
 * A script rather than a shell one-liner because Bun's shell expands `$VAR` but not
 * `${VAR:-default}`, and the port needs a default.
 */
const root = new URL("../", import.meta.url);
const standalone = new URL(".next/standalone/apps/docs/", root);

await cp(new URL(".next/static", root), new URL(".next/static", standalone), {
	recursive: true,
});
await cp(new URL("public", root), new URL("public", standalone), {
	recursive: true,
});

const server = Bun.spawn(["bun", "server.js"], {
	cwd: Bun.fileURLToPath(standalone),
	stdio: ["inherit", "inherit", "inherit"],
	env: { ...process.env, PORT: process.env.PORT ?? "3000" },
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
	process.on(signal, () => server.kill(signal));

process.exit(await server.exited);
