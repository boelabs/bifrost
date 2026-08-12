import { deleteExpiredVideoAssets, refreshDueVideoJobs } from "./service.ts";
import { log } from "#logging/log.ts";
import { env } from "#config/env.ts";

export function startVideoJobs(): () => void {
	let running = false;
	const run = async (): Promise<void> => {
		// Skip the tick if the previous one is still refreshing/downloading; job claiming
		// makes overlap safe across instances, but there is no point stacking local passes.
		if (running) return;
		running = true;
		try {
			await refreshDueVideoJobs().catch((err: unknown) => {
				log.error("videos", "poll job failed", { err });
			});
			await deleteExpiredVideoAssets()
				.then((deleted) => {
					if (deleted > 0)
						log.info("videos", "deleted expired video assets", { deleted });
				})
				.catch((err: unknown) => {
					log.error("videos", "asset gc failed", { err });
				});
		} finally {
			running = false;
		}
	};
	void run();
	const timer = setInterval(() => void run(), env.VIDEO_JOB_POLL_INTERVAL_MS);
	timer.unref();
	return () => clearInterval(timer);
}
