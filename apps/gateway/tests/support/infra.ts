/**
 * Utilities for INTEGRATION tests (*.integration.test.ts). Checks Redis/Postgres availability so a
 * file is SKIPPED (not failed) when the infra is unavailable. Each file runs in its own `bun test`
 * process (see scripts/run-integration.ts), which closes its connections on exit — so there is no
 * shared teardown to call.
 */

import { redis } from "#cache/redis.ts";
import { sql } from "#db/client.ts";

function raceTimeout<T>(p: Promise<T>, ms = 4000): Promise<T | null> {
	return Promise.race([
		p.then((v) => v).catch(() => null),
		new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
	]);
}

export async function redisAvailable(): Promise<boolean> {
	return (await raceTimeout(redis.ping())) === "PONG";
}

export async function pgAvailable(): Promise<boolean> {
	const rows = await raceTimeout(sql<{ ok: number }[]>`select 1 as ok`);
	return Array.isArray(rows) && rows[0]?.ok === 1;
}
