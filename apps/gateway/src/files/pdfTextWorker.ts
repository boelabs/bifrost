import { parentPort } from "node:worker_threads";
import { getDocumentProxy } from "unpdf";

interface PdfTextWorkerRequest {
	bytes: ArrayBuffer;
	maxCharacters: number;
	maxPages: number;
}

type PdfTextWorkerResponse =
	| { ok: true; text: string; totalPages: number }
	| {
			ok: false;
			code: "too_many_characters" | "too_many_pages" | "parse_failed";
			message: string;
	  };

async function extractBoundedText(
	document: Awaited<ReturnType<typeof getDocumentProxy>>,
	maxCharacters: number,
): Promise<string> {
	const pages: string[] = [];
	let characterCount = 0;
	for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
		const content = await (await document.getPage(pageNumber)).getTextContent();
		let pageText = "";
		for (const item of content.items) {
			if (!("str" in item)) continue;
			const fragment = item.str + (item.hasEOL ? "\n" : "");
			characterCount += fragment.length;
			if (characterCount > maxCharacters) {
				throw new RangeError(
					`PDF contains more than ${maxCharacters} characters`,
				);
			}
			pageText += fragment;
		}
		pages.push(pageText);
	}
	return pages
		.join("\n")
		.replace(/[^\S\n]+/g, " ")
		.replace(/ ?\n ?/g, "\n")
		.replace(/\n{3,}/g, "\n\n");
}

const port = parentPort;
if (port === null) throw new Error("PDF parser must run in a worker thread");

port.on("message", async (request: PdfTextWorkerRequest) => {
	let response: PdfTextWorkerResponse;
	try {
		const document = await getDocumentProxy(new Uint8Array(request.bytes));
		try {
			if (document.numPages > request.maxPages) {
				response = {
					ok: false,
					code: "too_many_pages",
					message: `PDF has ${document.numPages} pages`,
				};
			} else {
				const text = await extractBoundedText(document, request.maxCharacters);
				response = {
					ok: true,
					text,
					totalPages: document.numPages,
				};
			}
		} finally {
			await document.loadingTask.destroy().catch(() => undefined);
		}
	} catch (error) {
		response = {
			ok: false,
			code:
				error instanceof RangeError ? "too_many_characters" : "parse_failed",
			message: error instanceof Error ? error.message : String(error),
		};
	}
	port.postMessage(response);
});
