import { decryptJson, encryptJson, parseEncryptedEnvelope } from "./crypto.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("encrypted envelopes round-trip with an authenticated purpose and key id", () => {
	const envelope = encryptJson({ apiKey: "secret" }, "deployment-credentials");
	assert.equal(envelope.v, 2);
	assert.equal(envelope.alg, "A256GCM");
	assert.equal(envelope.kid, "test");
	assert.deepEqual(decryptJson(envelope, "deployment-credentials"), {
		apiKey: "secret",
	});
});

test("encrypted envelopes reject purpose confusion and authenticated-header tampering", () => {
	const envelope = encryptJson("source", "extension-source");
	assert.throws(() => decryptJson(envelope, "observability-payload"));
	assert.throws(() =>
		decryptJson(
			{ ...envelope, purpose: "observability-payload" },
			"observability-payload",
		),
	);
});

test("encrypted envelope parsing rejects unavailable key ids and invalid IV lengths", () => {
	const envelope = encryptJson({}, "deployment-credentials");
	assert.throws(() => parseEncryptedEnvelope({ ...envelope, kid: "missing" }));
	assert.throws(() => parseEncryptedEnvelope({ ...envelope, iv: "AA==" }));
});
