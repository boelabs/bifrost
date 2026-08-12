/**
 * Runs each integration test file in its OWN `bun test` process.
 *
 * Integration tests use a real Postgres and Redis through the shared app singletons and are written
 * for per-file isolation (one process each, the way `node --test` ran them). `bun test` runs every
 * file in a single shared process, which lets one file's connections and state leak into the next —
 * so we spawn one `bun test` per file here. The runner also invokes a separate cleanup process before
 * and after each file, so interrupted or failed test processes do not leave fake public models in the
 * operator database. Exits non-zero if any file or cleanup fails.
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// Every child process must receive a complete deterministic application environment. Preserve
// explicitly configured infrastructure URLs so developers and CI can point the suite at real test
// services, while keeping cryptographic test material isolated from ignored local `.env` files.
process.env.NODE_ENV = "test";
process.env.MASTER_KEY ??= "integration-test-master-key-32-chars";
process.env.ENCRYPTION_KEYRING ??= JSON.stringify({
	integration: "1".repeat(64),
});
process.env.ACTIVE_ENCRYPTION_KEY_ID ??= "integration";

function findIntegrationFiles(dir: string, out: string[] = []): string[] {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) findIntegrationFiles(full, out);
		else if (entry.name.endsWith(".integration.test.ts")) out.push(full);
	}
	return out;
}

const files = findIntegrationFiles("tests/integration").sort();
let failed = 0;

function cleanup(label: string): void {
	const result = spawnSync(
		process.execPath,
		["scripts/cleanup-integration.ts", label],
		{ env: process.env, stdio: "inherit" },
	);
	if (result.status !== 0) {
		failed += 1;
	}
}

cleanup("before run");

for (const file of files) {
	// process.execPath is the Bun binary running this script — robust on Windows and Linux/CI.
	// A generous per-test timeout (default 5s is too tight for the heaviest tests against remote
	// Postgres/Redis, where each round-trip adds latency; it is trivially fast against local CI infra).
	cleanup(`before ${file}`);
	const result = spawnSync(
		process.execPath,
		[
			"test",
			"--preload",
			"./tests/support/noRealFetch.ts",
			"--timeout",
			"30000",
			file,
		],
		{ env: process.env, stdio: "inherit" },
	);
	if (result.status !== 0) failed += 1;
	cleanup(`after ${file}`);
}

cleanup("after run");

console.log(
	failed === 0
		? `\n✓ All ${files.length} integration files passed.`
		: `\n✗ ${failed} of ${files.length} integration files failed.`,
);

process.exit(failed === 0 ? 0 : 1);
