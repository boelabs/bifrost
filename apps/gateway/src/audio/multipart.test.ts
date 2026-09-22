import { parseTranscriptionMultipart } from "./multipart.ts";
import { GatewayError } from "#core/errors.ts";
import { access } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";

function request(fields: [string, string][]): Request {
	const form = new FormData();
	form.append("model", "transcribe");
	form.append(
		"file",
		new File(["audio"], "audio.webm", { type: "audio/webm" }),
	);
	for (const [name, value] of fields) {
		form.append(name, value);
	}
	return new Request("http://localhost/v1/audio/transcriptions", {
		method: "POST",
		body: form,
	});
}

for (const suffix of ["", "[]"]) {
	test(`multipart audio: repeated hints with ${suffix || "bare"} field names`, async () => {
		const keywords = Array.from({ length: 40 }, (_, i) => `term ${i}`);
		const fields: [string, string][] = keywords.map((word) => [
			`keywords${suffix}`,
			word,
		]);
		fields.push([`languages${suffix}`, "es"], [`languages${suffix}`, "en"]);
		const parsed = await parseTranscriptionMultipart(request(fields));
		try {
			assert.deepEqual(parsed.fields.keywords, keywords);
			assert.deepEqual(parsed.fields.languages, ["es", "en"]);
			assert.deepEqual(parsed.logBody.keywords, keywords);
			await access(parsed.file.path);
		} finally {
			await parsed.cleanup();
		}
		await assert.rejects(access(parsed.file.path));
	});
}

test("multipart audio: rejects conflicting language hints and invalid keywords", async () => {
	for (const fields of [
		[
			["language", "es"],
			["languages[]", "en"],
		],
		[["keywords[]", "line\nbreak"]],
		[["keywords[]", "<term>"]],
	] satisfies [string, string][][]) {
		await assert.rejects(
			parseTranscriptionMultipart(request(fields)),
			(error: unknown) => {
				assert.ok(GatewayError.is(error));
				assert.equal(error.httpStatus, 400);
				assert.ok(
					error.param?.startsWith(
						fields[0]?.[0] === "language" ? "languages" : "keywords",
					),
				);
				return true;
			},
		);
	}
});
