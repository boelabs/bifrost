import assert from "node:assert/strict";
import { after, test } from "node:test";

import {
	validateAttachments,
	attachmentTypes,
	readAttachments,
} from "./attachments";

const originalFileReader = globalThis.FileReader;
if (typeof originalFileReader !== "function") {
	class BunFileReader {
		result: string | ArrayBuffer | null = null;
		error: DOMException | null = null;
		onload: ((event: ProgressEvent<FileReader>) => void) | null = null;
		onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
		onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;
		readAsDataURL(file: File) {
			file
				.arrayBuffer()
				.then((buffer) => {
					this.result = `data:${file.type.split(";")[0]};base64,${Buffer.from(buffer).toString("base64")}`;
					this.onload?.(undefined as unknown as ProgressEvent<FileReader>);
				})
				.catch((error: unknown) => {
					this.error =
						error instanceof DOMException
							? error
							: new DOMException(String(error));
					this.onerror?.(undefined as unknown as ProgressEvent<FileReader>);
				});
		}
	}
	globalThis.FileReader = BunFileReader as unknown as typeof FileReader;
}
after(() => {
	globalThis.FileReader = originalFileReader;
});

test("attachment types follow model modalities and endpoint capabilities", () => {
	assert.deepEqual(
		attachmentTypes(
			["image", "pdf", "file", "audio", "video"],
			"chat.completions",
		),
		[
			"image/png",
			"image/jpeg",
			"image/webp",
			"image/gif",
			"application/pdf",
			"text/plain",
			"audio/wav",
			"audio/mpeg",
			"video/mp4",
			"video/webm",
		],
	);
	assert.deepEqual(attachmentTypes(["image", "audio", "video"], "responses"), [
		"image/png",
		"image/jpeg",
		"image/webp",
		"image/gif",
	]);
	assert.deepEqual(attachmentTypes(["pdf", "file"], "messages"), [
		"application/pdf",
		"text/plain",
	]);
});

test("validation rejects unsupported and empty files before reading them", () => {
	const unsupported = new File(["data"], "notes.csv", { type: "text/csv" });
	assert.throws(
		() => validateAttachments([unsupported], ["text/plain"]),
		/notes\.csv: this file type is not supported/,
	);
	const empty = new File([], "empty.txt", { type: "text/plain" });
	assert.throws(
		() => validateAttachments([empty], ["text/plain;charset=utf-8"]),
		/empty\.txt: the file is empty/,
	);
});

test("reads accepted files as data URLs while preserving order and metadata", async () => {
	const files = [
		new File(["hello"], "hello.txt", { type: "text/plain" }),
		new File([new Uint8Array([0xde, 0xad])], "image.png", {
			type: "image/png",
		}),
	];
	const parts = await readAttachments(files, [
		"text/plain;charset=utf-8",
		"image/png",
	]);
	assert.deepEqual(parts, [
		{
			type: "file",
			filename: "hello.txt",
			mediaType: "text/plain;charset=utf-8",
			url: "data:text/plain;base64,aGVsbG8=",
		},
		{
			type: "file",
			filename: "image.png",
			mediaType: "image/png",
			url: "data:image/png;base64,3q0=",
		},
	]);
});

test("reading no files is a successful no-op", async () => {
	assert.deepEqual(await readAttachments([], []), []);
});
