/**
 * `next dev` on the dashboard's port.
 *
 * The default lives here rather than in the `dev` script because Bun's shell — which runs package
 * scripts — expands `$VAR` but not `${VAR:-default}`, so a POSIX default in package.json reaches
 * Next as the literal string `${DASH_PORT:-3001}`. It used to live in `vite.config.ts`; Next has no
 * equivalent hook for the dev server's port, so it lives in a script instead.
 */
const port = process.env.DASH_PORT ?? process.env.PORT ?? "3001";

// Resolved rather than taken from PATH: `bun run dev` puts node_modules/.bin there, but running
// this file directly does not, and the two should behave the same.
const next = Bun.fileURLToPath(import.meta.resolve("next/dist/bin/next"));

const dev = Bun.spawn(["bun", next, "dev", "--port", port], {
	stdio: ["inherit", "inherit", "inherit"],
});

// Ctrl-C reaches this process; pass it on so Next tears its own server down cleanly.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.on(signal, () => dev.kill(signal));
}

process.exit(await dev.exited);
