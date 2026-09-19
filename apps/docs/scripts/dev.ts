/**
 * `next dev` on the documentation's port.
 *
 * A script rather than a shell one-liner for the same reason as the dashboard's: Bun's shell — which
 * runs package scripts — expands `$VAR` but not `${VAR:-default}`, so a POSIX default in
 * package.json reaches Next as the literal string.
 */
const port = process.env.DOCS_PORT ?? process.env.PORT ?? "3000";

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
