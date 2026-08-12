import { invalidateRouterSettingsCache } from "#router/settings.ts";
import { makeGatewayTestApp } from "#test-support/app.ts";
import { pgAvailable } from "#test-support/infra.ts";
import { after, before, test } from "node:test";
import { adminApp } from "#admin/index.ts";
import assert from "node:assert/strict";
import { env } from "#config/env.ts";

import {
	type RouterSettingsPatch,
	type RouterSettingsRow,
	updateRouterSettings,
	getRouterSettings,
} from "#db/repos/router.ts";

const skip = (await pgAvailable()) ? false : "Postgres unavailable";
const auth = {
	authorization: `Bearer ${env.MASTER_KEY}`,
	"content-type": "application/json",
};
const app = makeGatewayTestApp((gateway) => {
	gateway.route("/admin", adminApp);
});
let originalSettings: RouterSettingsRow | undefined;

function settingsPatch(row: RouterSettingsRow): RouterSettingsPatch {
	return {
		routingStrategy: row.routingStrategy,
		unsupportedParameterStrategy: row.unsupportedParameterStrategy,
		allowedFails: row.allowedFails,
		cooldownSeconds: row.cooldownSeconds,
		failureWindowSeconds: row.failureWindowSeconds,
		maxCooldownSeconds: row.maxCooldownSeconds,
		halfOpenProbeSeconds: row.halfOpenProbeSeconds,
		configurationCooldownSeconds: row.configurationCooldownSeconds,
		throttleCooldownSeconds: row.throttleCooldownSeconds,
		executionPolicies: row.executionPolicies,
		retryAfterSeconds: row.retryAfterSeconds,
	};
}

before(async () => {
	if (skip) return;
	originalSettings = await getRouterSettings();
});

after(async () => {
	if (!originalSettings) return;
	await updateRouterSettings(settingsPatch(originalSettings));
	invalidateRouterSettingsCache();
});

test("router settings: execution policies are configurable by operation and mode", {
	skip,
}, async () => {
	const response = await app.request("/admin/router-settings", {
		method: "PUT",
		headers: auth,
		body: JSON.stringify({
			allowedFails: 0,
			cooldownSeconds: 7,
			executionPolicies: {
				...originalSettings!.executionPolicies,
				chat: {
					...originalSettings!.executionPolicies!.chat,
					stream: {
						...originalSettings!.executionPolicies!.chat.stream,
						firstOutputMs: 20_000,
						maxAttempts: 7,
					},
				},
			},
			retryAfterSeconds: 2,
		}),
	});
	assert.equal(response.status, 200);
	const body = (await response.json()) as {
		data: RouterSettingsRow;
	};
	assert.equal(body.data.allowedFails, 0);
	assert.equal(body.data.cooldownSeconds, 7);
	assert.equal(body.data.executionPolicies?.chat.stream.maxAttempts, 7);
	assert.equal(body.data.executionPolicies?.chat.stream.firstOutputMs, 20_000);
	assert.equal(body.data.retryAfterSeconds, 2);
	assert.equal("numRetries" in body.data, false);
});

test("router settings: removed global retry fields are rejected", {
	skip,
}, async () => {
	const response = await app.request("/admin/router-settings", {
		method: "PUT",
		headers: auth,
		body: JSON.stringify({
			numRetries: 3,
		}),
	});
	assert.equal(response.status, 400);
});
