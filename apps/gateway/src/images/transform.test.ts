import type { CanonicalImageRequest } from "#core/images.ts";
import { transformImageResponse } from "./transform.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";

test("image transform: PNG->WebP applies compression without changing dimensions", async () => {
	const png = await sharp({
		create: { width: 12, height: 8, channels: 4, background: "blue" },
	})
		.png()
		.toBuffer();
	const req: CanonicalImageRequest = {
		operation: "generation",
		model: "image",
		prompt: "p",
		stream: false,
		outputFormat: "webp",
		outputCompression: 75,
		size: "12x8",
	};
	const response = await transformImageResponse(
		{
			created: 1,
			data: [{ b64Json: png.toString("base64") }],
		},
		req,
	);
	assert.equal(response.size, "12x8");
	assert.equal(response.outputFormat, "webp");
	const metadata = await sharp(
		Buffer.from(response.data[0]!.b64Json!, "base64"),
	).metadata();
	assert.equal(metadata.format, "webp");
	assert.equal(metadata.width, 12);
	assert.equal(metadata.height, 8);
});

test("image transform: rejects different upstream size without resizing", async () => {
	const png = await sharp({
		create: { width: 10, height: 10, channels: 3, background: "white" },
	})
		.png()
		.toBuffer();
	await assert.rejects(
		transformImageResponse(
			{ created: 1, data: [{ b64Json: png.toString("base64") }] },
			{
				operation: "generation",
				model: "image",
				prompt: "p",
				stream: false,
				size: "20x20",
			},
		),
		/expected 20x20/,
	);
});

test("image transform: strips upstream metadata without stamping gateway branding", async () => {
	const vendorXmp = [
		'<?xpacket begin=""?>',
		'<x:xmpmeta xmlns:x="adobe:ns:meta/">',
		'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
		'<rdf:Description xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
		' xmp:CreatorTool="Google Gemini C2PA"/>',
		'</rdf:RDF></x:xmpmeta><?xpacket end="w"?>',
	].join("");

	for (const format of ["png", "jpeg", "webp"] as const) {
		{
			const upstream = await sharp({
				create: { width: 8, height: 6, channels: 4, background: "green" },
			})
				.toFormat(format, format === "jpeg" ? { quality: 90 } : {})
				.withExif({
					IFD0: {
						Software: "Google Gemini",
						Artist: "Vendor Artist",
						Copyright: "C2PA",
					},
				})
				.withXmp(vendorXmp)
				.toBuffer();

			const response = await transformImageResponse(
				{
					created: 1,
					data: [{ b64Json: upstream.toString("base64") }],
				},
				{ operation: "generation", model: "image", prompt: "p", stream: false },
			);

			const output = Buffer.from(response.data[0]!.b64Json, "base64");
			const metadata = await sharp(output).metadata();
			const exif = metadata.exif?.toString("latin1") ?? "";
			const xmp = metadata.xmpAsString ?? "";
			const brandedMetadata = `${exif}\n${xmp}`;

			assert.equal(metadata.format, format);
			assert.equal(metadata.width, 8);
			assert.equal(metadata.height, 6);
			assert.doesNotMatch(
				brandedMetadata,
				/Google|Gemini|Vendor Artist|C2PA|Bifrost|Boelabs/i,
			);
		}
	}
});
