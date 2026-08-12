import { imageResponseLog } from "#images/logging.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

test("image logs: never include b64_json or image bytes", () => {
	const log = imageResponseLog({
		created: 1,
		data: [
			{ b64Json: "secret-base64", mimeType: "image/png", width: 4, height: 3 },
		],
	});
	assert.equal(JSON.stringify(log).includes("secret-base64"), false);
	assert.deepEqual((log.images as Array<Record<string, unknown>>)[0], {
		kind: "b64_json",
		mime_type: "image/png",
		width: 4,
		height: 3,
		bytes: 9,
	});
});
