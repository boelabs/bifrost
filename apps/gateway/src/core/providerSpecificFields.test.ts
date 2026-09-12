import assert from "node:assert/strict";
import { test } from "node:test";

import {
	providerFieldsWithOpenAIResponsesStreamEvent,
	openaiResponsesStreamEventFromProviderFields,
	extraContentFromProviderSpecificFields,
	providerSpecificFieldsFromExtraContent,
	withoutOpenAIResponsesStreamMetadata,
	withoutOpenAIResponsesReasoningState,
	providerSpecificFieldsFromToolCalls,
	providerFieldsWithOpenAIReasoning,
	openaiReasoningFromProviderFields,
	thoughtSignatureFromExtraContent,
	mergeProviderExtraContent,
	encodeThoughtSignatureId,
	decodeThoughtSignatureId,
	stripThoughtSignatureId,
} from "./providerSpecificFields.ts";

test("thought signature id: encode/decode round trip", () => {
	const extraContent = { google: { thought_signature: "EjQKMgER+/=" } };
	const encoded = encodeThoughtSignatureId("call_1", extraContent);
	assert.equal(encoded, "call_1__thought__EjQKMgER+/=");
	assert.deepEqual(decodeThoughtSignatureId(encoded), {
		id: "call_1",
		extraContent,
	});
});

test("thought signature id: decode without suffix returns id untouched", () => {
	assert.deepEqual(decodeThoughtSignatureId("call_1"), { id: "call_1" });
	assert.deepEqual(decodeThoughtSignatureId(42), { id: "" });
});

test("thought signature id: suffix is stripped even when the signature is empty", () => {
	assert.deepEqual(decodeThoughtSignatureId("call_1__thought__"), {
		id: "call_1",
	});
});

test("thought signature id: encode is a no-op without id, signature, or when already suffixed", () => {
	const extraContent = { google: { thought_signature: "sig" } };
	assert.equal(encodeThoughtSignatureId("", extraContent), "");
	assert.equal(encodeThoughtSignatureId("call_1", undefined), "call_1");
	assert.equal(
		encodeThoughtSignatureId("call_1", { google: { thought_signature: "" } }),
		"call_1",
	);
	assert.equal(
		encodeThoughtSignatureId("call_1__thought__sig", extraContent),
		"call_1__thought__sig",
	);
});

test("thought signature id: separator cannot collide with base64 signatures", () => {
	// Gemini signatures are standard base64 (A-Za-z0-9+/=): `_` cannot appear, so splitting on
	// the first separator occurrence is unambiguous even for adversarial-looking values.
	const base64 = /^[A-Za-z0-9+/=]+$/;
	const signature = "EjQKMgERTTIPxOSJU+6ZAGTusp00q9PqtMCjw3RPFew/=";
	assert.ok(base64.test(signature));
	assert.ok(!signature.includes("_"));
	const decoded = decodeThoughtSignatureId(`call_1__thought__${signature}`);
	assert.deepEqual(decoded, {
		id: "call_1",
		extraContent: { google: { thought_signature: signature } },
	});
});

test("thought signature id: long signatures remain in the stateless carrier", () => {
	const signature = "a".repeat(200);
	assert.equal(
		encodeThoughtSignatureId("call_1", {
			google: { thought_signature: signature },
		}),
		`call_1__thought__${signature}`,
	);
});

test("thought signature id: strip removes the suffix from tool-result references", () => {
	assert.equal(stripThoughtSignatureId("call_1__thought__sig"), "call_1");
	assert.equal(stripThoughtSignatureId("call_1"), "call_1");
});

test("provider specific fields: maps LiteLLM aliases", () => {
	assert.deepEqual(
		extraContentFromProviderSpecificFields({ thought_signature: "sig-a" }),
		{ google: { thought_signature: "sig-a" } },
	);
	assert.equal(
		thoughtSignatureFromExtraContent({
			google: { thoughtSignature: "sig-camel" },
		}),
		"sig-camel",
	);
	assert.deepEqual(
		providerSpecificFieldsFromExtraContent({
			google: { thought_signature: "sig-a" },
		}),
		{ thought_signature: "sig-a" },
	);
	assert.deepEqual(
		providerSpecificFieldsFromToolCalls([
			{ extraContent: { google: { thought_signature: "sig-a" } } },
			{},
		]),
		{ thought_signatures: ["sig-a"] },
	);
});

test("provider specific fields: merges namespaces without dropping sibling metadata", () => {
	assert.deepEqual(
		mergeProviderExtraContent(
			{ google: { thought_signature: "sig-a" } },
			{ google: { other: true }, openai: { item_id: "call_1" } },
		),
		{
			google: { thought_signature: "sig-a", other: true },
			openai: { item_id: "call_1" },
		},
	);
	assert.equal(mergeProviderExtraContent(undefined, undefined), undefined);
});

test("openai reasoning state: builds and reads the namespaced record", () => {
	const items = [
		{ id: "rs_1", encrypted_content: "enc-1", summary: [] },
		{ encrypted_content: "enc-2" },
	];
	const fields = providerFieldsWithOpenAIReasoning(items);
	assert.deepEqual(openaiReasoningFromProviderFields(fields), items);
});

test("openai reasoning state: drops malformed or empty items", () => {
	assert.equal(openaiReasoningFromProviderFields(undefined), undefined);
	assert.equal(
		openaiReasoningFromProviderFields({ openai: { reasoning: "nope" } }),
		undefined,
	);
	assert.equal(
		openaiReasoningFromProviderFields({
			openai: { reasoning: [{ encrypted_content: "" }, null, "x"] },
		}),
		undefined,
	);
	assert.deepEqual(
		openaiReasoningFromProviderFields({
			openai: {
				reasoning: [{ encrypted_content: "enc", id: "", summary: "bad" }],
			},
		}),
		[{ encrypted_content: "enc" }],
	);
});

test("openai reasoning state: native output rendering removes duplicate message state", () => {
	assert.deepEqual(
		withoutOpenAIResponsesReasoningState({
			google: { thought_signature: "sig-a" },
			openai: {
				reasoning: [{ id: "rs_1", encrypted_content: "enc-1" }],
				responses: { reasoning_item_id: "rs_1", sibling: true },
				other: "kept",
			},
		}),
		{
			google: { thought_signature: "sig-a" },
			openai: { responses: { sibling: true }, other: "kept" },
		},
	);
	assert.equal(
		withoutOpenAIResponsesReasoningState({
			openai: {
				reasoning: [{ id: "rs_1", encrypted_content: "enc-1" }],
				responses: { reasoning_item_id: "rs_1" },
			},
		}),
		undefined,
	);
});

test("openai responses stream metadata: round-trips internally and never reaches messages", () => {
	const fields = mergeProviderExtraContent(
		providerFieldsWithOpenAIResponsesStreamEvent("response.output_item.added", {
			type: "response.output_item.added",
			sequence_number: 41,
			output_index: 0,
			item: { type: "message", id: "msg_1" },
		}),
		{
			openai: {
				responses: { stream_output: [{ type: "message", id: "msg_1" }] },
				other: "kept",
			},
			google: { thought_signature: "sig-a" },
		},
	);
	assert.deepEqual(openaiResponsesStreamEventFromProviderFields(fields), {
		type: "response.output_item.added",
		data: { output_index: 0, item: { type: "message", id: "msg_1" } },
	});
	assert.deepEqual(withoutOpenAIResponsesStreamMetadata(fields), {
		openai: { other: "kept" },
		google: { thought_signature: "sig-a" },
	});
});
