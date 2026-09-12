import { closeRedis } from "#cache/redis.ts";
import { closeDb, sql } from "#db/client.ts";

import {
	cleanupIntegrationArtifacts,
	hasIntegrationCleanupWork,
} from "#test-support/integrationCleanup.ts";

const label = process.argv[2] ?? "manual";

async function postgresAvailable(): Promise<boolean> {
	const timeoutSignal = Promise.withResolvers<false>();
	const timeout = setTimeout(() => timeoutSignal.resolve(false), 15_000);
	const ping = sql<{ ok: number }[]>`select 1 as ok`
		.then((rows) => rows[0]?.ok === 1)
		.catch(() => false);
	try {
		return await Promise.race([ping, timeoutSignal.promise]);
	} finally {
		clearTimeout(timeout);
	}
}

try {
	if (!(await postgresAvailable())) {
		console.log(
			`[integration cleanup] ${label}: Postgres unavailable, skipped`,
		);
		process.exitCode = 0;
	} else {
		const summary = await cleanupIntegrationArtifacts();
		if (hasIntegrationCleanupWork(summary)) {
			console.log(`[integration cleanup] ${label}: ${JSON.stringify(summary)}`);
		}
	}
} catch (err) {
	console.error(`[integration cleanup] ${label} failed`, err);
	process.exitCode = 1;
} finally {
	await closeRedis();
	await closeDb();
}
