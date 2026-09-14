/**
 * Integration coverage for router metrics and the Redis circuit breaker. Every test uses unique
 * subjects so it is safe across concurrently running integration files.
 */

import { redisAvailable } from "#test-support/infra.ts";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { redis } from "#cache/redis.ts";
import { test } from "node:test";

import {
	recordConfigurationFailure,
	recordTransientFailure,
	recordThrottleFailure,
	type CircuitSettings,
	acquireCircuitPermit,
	getCircuitSnapshots,
	deploymentSubject,
	getCircuitCauses,
	capacitySubject,
	closeCircuits,
	resetCircuits,
} from "#router/circuit.ts";

import {
	onAttemptCancel,
	onSuccessFinish,
	onAttemptStart,
	fetchMetrics,
} from "#router/state.ts";

const skip = (await redisAvailable()) ? false : "Redis unavailable";
const wait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, ms));

function settings(overrides: Partial<CircuitSettings> = {}): CircuitSettings {
	return {
		enabled: true,
		allowedFails: 2,
		// The rate rule is disabled by default in these tests (a floor above any traffic they
		// generate), so each case exercises exactly the predicate it names.
		failureRatePercent: 1,
		minWindowRequests: 1_000_000,
		failureWindowMs: 1000,
		baseCooldownMs: 100,
		maxCooldownMs: 1000,
		probeTtlMs: 500,
		...overrides,
	};
}

async function cleanup(
	ids: string[],
	circuitPrefixes: string[] = [],
): Promise<void> {
	const bucket = Math.floor(Date.now() / 60_000);
	const keys = ids.flatMap((id) => [
		`rt:v2:inflight:${id}`,
		`rt:v2:inflight-leases:${id}`,
		`rt:failures:${id}`,
		`rt:successes:${id}`,
		`rt:latency_ms:${id}`,
		`rt:throughput_tps:${id}`,
		`rt:rpm:${id}:${bucket}`,
		`rt:tpm:${id}:${bucket}`,
		`rt:tpm-reserved:${id}:${bucket}`,
	]);
	for (const prefix of circuitPrefixes) {
		for (const suffix of [
			"cooldown",
			"cause",
			"failures",
			"history",
			"probe",
			"attempts",
		])
			keys.push(`${prefix}:${suffix}`);
	}
	if (keys.length > 0) await redis.del(...keys);
}

function prefix(subject: { kind: string; id: string }): string {
	return `rt:circuit:${subject.kind}:${subject.id}`;
}

test("inflight/rpm: start counts, success/cancel release without penalty", {
	skip,
}, async () => {
	const id = randomUUID();
	try {
		const first = await onAttemptStart(id);
		const second = await onAttemptStart(id);
		assert.equal(first.accepted, true);
		assert.equal(second.accepted, true);
		if (!first.accepted || !second.accepted) return;
		let metrics = (await fetchMetrics([id])).get(id)!;
		assert.equal(metrics.inflight, 2);
		assert.equal(metrics.rpm, 2);

		await onAttemptCancel(id, undefined, first.lease);
		metrics = (await fetchMetrics([id])).get(id)!;
		assert.equal(metrics.inflight, 1);
		assert.equal(metrics.failures, 0);

		await onSuccessFinish(
			id,
			{
				totalTokens: 100,
				completionTokens: 25,
				durationMs: 1000,
				firstOutputMs: 1000,
			},
			undefined,
			second.lease,
		);
		metrics = (await fetchMetrics([id])).get(id)!;
		assert.equal(metrics.inflight, 0);
		assert.equal(metrics.tpm, 100);
		assert.equal(metrics.throughputTps, 25);
	} finally {
		await cleanup([id]);
	}
});

test("deployment admission enforces RPM atomically under concurrency", {
	skip,
}, async () => {
	const id = randomUUID();
	try {
		const admissions = await Promise.all(
			Array.from({ length: 20 }, () =>
				onAttemptStart(id, {
					rpmLimit: 3,
					tpmLimit: null,
					reservedTokens: 0,
				}),
			),
		);
		const accepted = admissions.flatMap((result) =>
			result.accepted ? [result.lease] : [],
		);
		assert.equal(accepted.length, 3);
		await Promise.all(
			accepted.map((lease) => onAttemptCancel(id, undefined, lease)),
		);
		const metrics = (await fetchMetrics([id])).get(id)!;
		assert.equal(metrics.inflight, 0);
		assert.equal(metrics.rpm, 3);
	} finally {
		await cleanup([id]);
	}
});

test("deployment TPM reservations are atomic and reconcile to actual usage", {
	skip,
}, async () => {
	const id = randomUUID();
	try {
		const admissions = await Promise.all(
			Array.from({ length: 10 }, () =>
				onAttemptStart(id, {
					rpmLimit: null,
					tpmLimit: 100,
					reservedTokens: 40,
				}),
			),
		);
		const accepted = admissions.flatMap((result) =>
			result.accepted ? [result.lease] : [],
		);
		assert.equal(accepted.length, 2);
		await Promise.all(
			accepted.map((lease) =>
				onSuccessFinish(
					id,
					{
						totalTokens: 10,
						completionTokens: 5,
						durationMs: 100,
						firstOutputMs: 100,
					},
					undefined,
					lease,
				),
			),
		);
		const next = await onAttemptStart(id, {
			rpmLimit: null,
			tpmLimit: 100,
			reservedTokens: 40,
		});
		assert.equal(next.accepted, true);
		if (next.accepted) await onAttemptCancel(id, undefined, next.lease);
		const metrics = (await fetchMetrics([id])).get(id)!;
		assert.equal(metrics.tpm, 20);
	} finally {
		await cleanup([id]);
	}
});

test("deployment TPM settlement reconciles the admission minute across a boundary", {
	skip,
}, async () => {
	const id = randomUUID();
	const realNow = Date.now;
	const start = Math.floor(realNow() / 60_000) * 60_000 + 1;
	const bucket = Math.floor(start / 60_000);
	try {
		Date.now = () => start;
		const admission = await onAttemptStart(id, {
			rpmLimit: null,
			tpmLimit: 100,
			reservedTokens: 40,
		});
		assert.equal(admission.accepted, true);
		if (!admission.accepted) return;
		Date.now = () => start + 60_000;
		await onSuccessFinish(
			id,
			{
				totalTokens: 10,
				completionTokens: 5,
				durationMs: 100,
				firstOutputMs: 100,
			},
			undefined,
			admission.lease,
		);
		assert.equal(Number(await redis.get(`rt:tpm:${id}:${bucket}`)), 10);
		assert.equal(await redis.get(`rt:tpm-reserved:${id}:${bucket}`), null);
		assert.equal(await redis.get(`rt:tpm:${id}:${bucket + 1}`), null);
	} finally {
		Date.now = realNow;
		await redis.del(
			`rt:v2:inflight:${id}`,
			`rt:v2:inflight-leases:${id}`,
			`rt:successes:${id}`,
			`rt:latency_ms:${id}`,
			`rt:throughput_tps:${id}`,
			`rt:rpm:${id}:${bucket}`,
			`rt:tpm:${id}:${bucket}`,
			`rt:tpm-reserved:${id}:${bucket}`,
			`rt:tpm:${id}:${bucket + 1}`,
			`rt:tpm-reserved:${id}:${bucket + 1}`,
		);
	}
});

test("expired inflight leases self-heal while deployment traffic continues", {
	skip,
}, async () => {
	const id = randomUUID();
	try {
		const abandoned = await onAttemptStart(id);
		assert.equal(abandoned.accepted, true);
		if (!abandoned.accepted) return;
		await redis.zadd(
			`rt:v2:inflight-leases:${id}`,
			Date.now() - 1,
			abandoned.lease.id,
		);
		const active = await onAttemptStart(id);
		assert.equal(active.accepted, true);
		if (!active.accepted) return;
		assert.equal((await fetchMetrics([id])).get(id)?.inflight, 1);

		// A late settlement from the expired owner cannot decrement the active lease.
		await onAttemptCancel(id, undefined, abandoned.lease);
		assert.equal((await fetchMetrics([id])).get(id)?.inflight, 1);
		await onAttemptCancel(id, undefined, active.lease);
		assert.equal((await fetchMetrics([id])).get(id)?.inflight, 0);
	} finally {
		await cleanup([id]);
	}
});

test("circuit: fixed failure window does not slide on every failure", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({ failureWindowMs: 60 });
	try {
		const first = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(first.allowed, true);
		if (!first.allowed) return;
		await recordTransientFailure(first.permit, config, {
			class: "server",
			message: "first",
		});
		await wait(90);
		const second = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(second.allowed, true);
		if (!second.allowed) return;
		await recordTransientFailure(second.permit, config, {
			class: "server",
			message: "second",
		});
		const [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "available");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: allowed failures are honored before cooldown, half-open admits one probe", {
	skip,
	// Sleeps ~3.6s waiting out real cooldowns; the 5s default leaves no room for round trips.
	timeout: 20_000,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({
		baseCooldownMs: 1000,
		maxCooldownMs: 5000,
		probeTtlMs: 2000,
	});
	try {
		for (const message of ["first", "second", "third"]) {
			const acquired = await acquireCircuitPermit(deployment, capacity, config);
			assert.equal(acquired.allowed, true);
			if (!acquired.allowed) return;
			await recordTransientFailure(acquired.permit, config, {
				class: "server",
				message,
				...(message === "third"
					? { body: { error: { message: "sensitive provider detail" } } }
					: {}),
			});
			const [current] = await getCircuitSnapshots([{ deployment, capacity }]);
			assert.equal(
				current?.status,
				message === "third" ? "cooldown" : "available",
			);
		}
		let [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");
		assert.ok((snapshot?.retryAfterMs ?? 0) > 0);
		const causes = await getCircuitCauses([deployment]);
		const cause = causes.get(`deployment:${id}`);
		assert.equal(cause?.message, "Upstream server failure");
		assert.match(cause?.fingerprint ?? "", /^[a-f0-9]{24}$/);
		assert.equal(cause?.body, undefined);

		await wait(1250);
		const probes = await Promise.all([
			acquireCircuitPermit(deployment, capacity, config),
			acquireCircuitPermit(deployment, capacity, config),
		]);
		assert.equal(probes.filter((probe) => probe.allowed).length, 1);
		const probe = probes.find((candidate) => candidate.allowed);
		assert.ok(probe?.allowed);
		if (!probe?.allowed) return;
		assert.equal(probe.permit.deploymentMode, "half_open");
		await recordTransientFailure(probe.permit, config, {
			class: "server",
			message: "probe failed",
		});

		[snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");
		assert.ok((snapshot?.retryAfterMs ?? 0) >= 900);

		await wait(2300);
		const recovery = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(recovery.allowed, true);
		if (!recovery.allowed) return;
		assert.equal(recovery.permit.deploymentMode, "half_open");
		await closeCircuits(recovery.permit);
		[snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "available");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

async function drive(
	deployment: ReturnType<typeof deploymentSubject>,
	capacity: ReturnType<typeof capacitySubject>,
	config: CircuitSettings,
	outcome: "success" | "failure",
	options: { mayOpen?: boolean } = {},
): Promise<"blocked" | "ok"> {
	const acquired = await acquireCircuitPermit(deployment, capacity, config);
	if (!acquired.allowed) return "blocked";
	if (outcome === "success") await closeCircuits(acquired.permit);
	else
		await recordTransientFailure(
			acquired.permit,
			config,
			{ class: "server", message: "upstream" },
			options,
		);
	return "ok";
}

test("circuit: a minority of failures in a busy window does not open", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	// The absolute ceiling is out of the way, so only the rate rule can act here.
	const config = settings({
		allowedFails: 100,
		failureRatePercent: 0.5,
		minWindowRequests: 5,
		failureWindowMs: 60_000,
	});
	try {
		for (let i = 0; i < 7; i += 1)
			assert.equal(await drive(deployment, capacity, config, "success"), "ok");
		for (let i = 0; i < 3; i += 1)
			assert.equal(await drive(deployment, capacity, config, "failure"), "ok");
		// 3 failures in 10 attempts. The old absolute count would have quarantined this deployment
		// twice over while it was serving 70% of its traffic successfully.
		const [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "available");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: the rate rule opens once the window carries enough traffic", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({
		allowedFails: 100,
		failureRatePercent: 0.5,
		minWindowRequests: 5,
		failureWindowMs: 60_000,
		// Long enough that reading the snapshot cannot race the cooldown expiring.
		baseCooldownMs: 30_000,
		maxCooldownMs: 60_000,
	});
	try {
		for (let i = 0; i < 2; i += 1)
			assert.equal(await drive(deployment, capacity, config, "success"), "ok");
		// Attempts 3 and 4 fail, but the window has not reached the traffic floor yet.
		for (let i = 0; i < 2; i += 1)
			await drive(deployment, capacity, config, "failure");
		let [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "available");

		// The fifth attempt reaches the floor at 3/5 failures, over the 50% rate.
		await drive(deployment, capacity, config, "failure");
		[snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: the last routable deployment is never quarantined", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({ allowedFails: 0, baseCooldownMs: 5000 });
	try {
		// Every rule says open; the veto is what keeps the pool serving.
		for (let i = 0; i < 3; i += 1)
			assert.equal(
				await drive(deployment, capacity, config, "failure", {
					mayOpen: false,
				}),
				"ok",
			);
		let [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "available");

		// The failures were still counted, so the circuit opens the moment an alternative exists.
		await drive(deployment, capacity, config, "failure", { mayOpen: true });
		[snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: a misconfigured deployment is quarantined at once when there is somewhere else to go", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({ allowedFails: 10, baseCooldownMs: 5000 });
	try {
		const acquired = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(acquired.allowed, true);
		if (!acquired.allowed) return;
		// No threshold to reach: bad credentials fail every request the same way, so one is proof.
		await recordConfigurationFailure(
			acquired.permit,
			config,
			{ class: "not_found", message: "model not found" },
			300_000,
			{ mayOpen: true },
		);
		const [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: the last deployment is not quarantined for being misconfigured", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({ allowedFails: 0, baseCooldownMs: 5000 });
	try {
		// Repeatedly, because a misconfiguration never stops failing: every request must keep
		// reaching the upstream and coming back with the error that says what is wrong, rather than
		// being answered from a cooldown that will still be there five minutes later.
		for (let i = 0; i < 3; i += 1) {
			const acquired = await acquireCircuitPermit(deployment, capacity, config);
			assert.equal(acquired.allowed, true);
			if (!acquired.allowed) return;
			await recordConfigurationFailure(
				acquired.permit,
				config,
				{ class: "not_found", message: "model not found" },
				300_000,
				{ mayOpen: false },
			);
			const [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
			assert.equal(snapshot?.status, "available");
		}

		// The moment an alternative exists, failing over is the better answer after all.
		const acquired = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(acquired.allowed, true);
		if (!acquired.allowed) return;
		await recordConfigurationFailure(
			acquired.permit,
			config,
			{ class: "not_found", message: "model not found" },
			300_000,
			{ mayOpen: true },
		);
		const [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: a forced admission cannot escalate, and its success clears the circuit", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({
		allowedFails: 0,
		baseCooldownMs: 30_000,
		maxCooldownMs: 60_000,
	});
	try {
		await drive(deployment, capacity, config, "failure");
		let [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");
		const openedTtl = snapshot?.retryAfterMs ?? 0;
		assert.ok(openedTtl > 0);

		// Without force the pool would have nothing to offer.
		const refused = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(refused.allowed, false);

		const forced = await acquireCircuitPermit(
			deployment,
			capacity,
			config,
			true,
		);
		assert.equal(forced.allowed, true);
		if (!forced.allowed) return;
		assert.equal(forced.permit.deploymentMode, "forced");
		// A forced attempt is a symptom of the open circuit, not evidence about the upstream.
		assert.equal(
			await recordTransientFailure(forced.permit, config, {
				class: "server",
				message: "still failing",
			}),
			null,
		);
		[snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");
		assert.ok((snapshot?.retryAfterMs ?? 0) <= openedTtl);

		const recovered = await acquireCircuitPermit(
			deployment,
			capacity,
			config,
			true,
		);
		assert.ok(recovered.allowed);
		if (!recovered.allowed) return;
		await closeCircuits(recovered.permit);
		[snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "available");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: the episode window does not slide on every failed probe", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({
		allowedFails: 0,
		baseCooldownMs: 200,
		maxCooldownMs: 60_000,
		probeTtlMs: 2000,
	});
	try {
		const first = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(first.allowed, true);
		if (!first.allowed) return;
		const openedFor = await recordTransientFailure(first.permit, config, {
			class: "server",
			message: "opens the episode",
		});
		const historyKey = `${prefix(deployment)}:history`;
		const openedTtl = await redis.pttl(historyKey);
		assert.ok(openedTtl > 0);

		// A client retrying in a loop must not be able to keep the deployment half-open forever: the
		// probe still escalates the backoff, but it may not push the episode's expiry forward.
		await wait(300);
		const probe = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(probe.allowed, true);
		if (!probe.allowed) return;
		assert.equal(probe.permit.deploymentMode, "half_open");
		const reopenedFor = await recordTransientFailure(probe.permit, config, {
			class: "server",
			message: "probe failed",
		});
		const afterProbeTtl = await redis.pttl(historyKey);
		assert.ok(
			afterProbeTtl < openedTtl,
			`history TTL slid forward: ${openedTtl} -> ${afterProbeTtl}`,
		);
		// The escalation itself is untouched: a second open still doubles the cooldown.
		assert.ok((reopenedFor ?? 0) > (openedFor ?? 0) * 1.5);
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: an operator reset forgets the cooldown and the episode", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({
		allowedFails: 0,
		baseCooldownMs: 60_000,
		maxCooldownMs: 60_000,
	});
	try {
		const acquired = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(acquired.allowed, true);
		if (!acquired.allowed) return;
		await recordTransientFailure(acquired.permit, config, {
			class: "server",
			message: "quarantined",
		});
		let [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");

		await resetCircuits([deployment, capacity]);

		[snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "available");
		assert.equal(snapshot?.retryAfterMs, null);
		assert.equal((await getCircuitCauses([deployment])).size, 0);
		// A reset deployment is routed to at full confidence, not as a half-open probe.
		const recovered = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(recovered.allowed, true);
		if (!recovered.allowed) return;
		assert.equal(recovered.permit.deploymentMode, "closed");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: zero allowed failures opens on the first transient failure", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({ allowedFails: 0, baseCooldownMs: 1000 });
	try {
		const acquired = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(acquired.allowed, true);
		if (!acquired.allowed) return;
		await recordTransientFailure(acquired.permit, config, {
			class: "server",
			message: "first",
		});
		const [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "cooldown");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("circuit: a successful call resets accumulated transient failures", {
	skip,
}, async () => {
	const id = randomUUID();
	const deployment = deploymentSubject(id);
	const capacity = capacitySubject(id, null);
	const config = settings({ allowedFails: 1 });
	try {
		const first = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(first.allowed, true);
		if (!first.allowed) return;
		await recordTransientFailure(first.permit, config, {
			class: "server",
			message: "first",
		});

		const success = await acquireCircuitPermit(deployment, capacity, config);
		assert.equal(success.allowed, true);
		if (!success.allowed) return;
		await closeCircuits(success.permit);

		const afterSuccess = await acquireCircuitPermit(
			deployment,
			capacity,
			config,
		);
		assert.equal(afterSuccess.allowed, true);
		if (!afterSuccess.allowed) return;
		await recordTransientFailure(afterSuccess.permit, config, {
			class: "server",
			message: "after success",
		});
		const [snapshot] = await getCircuitSnapshots([{ deployment, capacity }]);
		assert.equal(snapshot?.status, "available");
	} finally {
		await cleanup([], [prefix(deployment), prefix(capacity)]);
	}
});

test("capacity circuit: Retry-After state is shared by one configured failure domain", {
	skip,
}, async () => {
	const firstDeployment = deploymentSubject(randomUUID());
	const secondDeployment = deploymentSubject(randomUUID());
	const capacity = capacitySubject(firstDeployment.id, "provider-account-a");
	const sameCapacity = capacitySubject(
		secondDeployment.id,
		"provider-account-a",
	);
	const config = settings();
	assert.equal(capacity.id, sameCapacity.id);
	try {
		const first = await acquireCircuitPermit(firstDeployment, capacity, config);
		assert.equal(first.allowed, true);
		if (!first.allowed) return;
		await recordThrottleFailure(
			first.permit,
			config,
			{ class: "rate_limit", message: "quota exhausted", status: 429 },
			1000,
		);
		const second = await acquireCircuitPermit(
			secondDeployment,
			sameCapacity,
			config,
		);
		assert.equal(second.allowed, false);
		if (second.allowed) return;
		assert.equal(second.blockedBy, "capacity");
		assert.ok(second.retryAfterMs > 0);

		const bypass = await acquireCircuitPermit(secondDeployment, sameCapacity, {
			...config,
			enabled: false,
		});
		assert.equal(bypass.allowed, true);
		const [cleared] = await getCircuitSnapshots([
			{ deployment: secondDeployment, capacity: sameCapacity },
		]);
		assert.equal(cleared?.status, "available");
	} finally {
		await cleanup(
			[],
			[prefix(firstDeployment), prefix(secondDeployment), prefix(capacity)],
		);
	}
});
