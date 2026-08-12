import { pruneExtensionCache } from "./source.ts";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
	writeFile,
	mkdtemp,
	access,
	utimes,
	mkdir,
	rm,
} from "node:fs/promises";

async function exists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

test("extension cache pruning keeps active modules and removes inactive/stale files", async () => {
	const cacheDir = await mkdtemp(join(tmpdir(), "gateway-extension-cache-"));
	try {
		await mkdir(cacheDir, { recursive: true });
		const hash = "a".repeat(64);
		const active = join(cacheDir, `active-${hash}.mjs`);
		const inactive = join(cacheDir, `inactive-${hash}.mjs`);
		const staleTemp = join(cacheDir, "abandoned.tmp");
		const recentTemp = join(cacheDir, "recent.tmp");
		await Promise.all([
			writeFile(active, "export default {}"),
			writeFile(inactive, "export default {}"),
			writeFile(staleTemp, ""),
			writeFile(recentTemp, ""),
		]);
		const old = new Date(Date.now() - 10 * 60_000);
		await utimes(staleTemp, old, old);

		assert.equal(await pruneExtensionCache(new Set([active]), cacheDir), 2);
		assert.equal(await exists(active), true);
		assert.equal(await exists(inactive), false);
		assert.equal(await exists(staleTemp), false);
		assert.equal(await exists(recentTemp), true);
	} finally {
		await rm(cacheDir, { recursive: true, force: true });
	}
});
