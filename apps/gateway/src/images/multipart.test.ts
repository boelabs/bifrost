import { parseImageEditMultipart } from "./multipart.ts";
import { access } from "node:fs/promises";
import assert from "node:assert/strict";
import { File } from "node:buffer";
import { test } from "node:test";
import sharp from "sharp";

async function png(width = 6, height = 4): Promise<Buffer> {
	return sharp({ create: { width, height, channels: 4, background: "green" } })
		.png()
		.toBuffer();
}

test("multipart edits: accepts image/image[], extra_body, and cleans temporaries", async () => {
	const form = new FormData();
	form.append("model", "image");
	form.append("prompt", "edit");
	form.append("stream", "false");
	form.append(
		"extra_body",
		JSON.stringify({ image_config: { strength: 0.5 } }),
	);
	form.append(
		"image",
		new File([new Uint8Array(await png())], "one.png", { type: "image/png" }),
	);
	form.append(
		"image[]",
		new File([new Uint8Array(await png())], "two.png", { type: "image/png" }),
	);
	const parsed = await parseImageEditMultipart(
		new Request("http://localhost/v1/images/edits", {
			method: "POST",
			body: form,
		}),
	);
	assert.equal(parsed.images.length, 2);
	assert.deepEqual(parsed.fields.extra_body, {
		image_config: { strength: 0.5 },
	});
	const path = parsed.images[0]!.path;
	await access(path);
	await parsed.cleanup();
	await assert.rejects(access(path));
});

test("multipart edits: validates PNG mask and dimensions", async () => {
	const form = new FormData();
	form.append("model", "image");
	form.append("prompt", "edit");
	form.append(
		"image",
		new File([new Uint8Array(await png(6, 4))], "image.png", {
			type: "image/png",
		}),
	);
	form.append(
		"mask",
		new File([new Uint8Array(await png(5, 4))], "mask.png", {
			type: "image/png",
		}),
	);
	await assert.rejects(
		parseImageEditMultipart(
			new Request("http://localhost/v1/images/edits", {
				method: "POST",
				body: form,
			}),
		),
		/mask dimensions/,
	);
});

test("multipart edits: rejects unexpected file and invalid extra_body", async () => {
	const form = new FormData();
	form.append("model", "image");
	form.append("prompt", "edit");
	form.append("extra_body", "[]");
	form.append(
		"reference",
		new File([new Uint8Array(await png())], "image.png", { type: "image/png" }),
	);
	await assert.rejects(
		parseImageEditMultipart(
			new Request("http://localhost/v1/images/edits", {
				method: "POST",
				body: form,
			}),
		),
		/Unexpected file field|JSON object/,
	);
});
