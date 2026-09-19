import type { PublicEndpoint } from "./api";
import type { FileUIPart } from "ai";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export function attachmentTypes(
	modalities: string[],
	endpoint: PublicEndpoint,
): string[] {
	return [
		...(modalities.includes("image") ? IMAGE_TYPES : []),
		...(modalities.includes("pdf") || modalities.includes("file")
			? ["application/pdf"]
			: []),
		...(modalities.includes("file") ? ["text/plain"] : []),
		...(endpoint === "chat.completions" && modalities.includes("audio")
			? ["audio/wav", "audio/mpeg"]
			: []),
		...(endpoint === "chat.completions" && modalities.includes("video")
			? ["video/mp4", "video/webm"]
			: []),
	];
}

export function validateAttachments(files: File[], accepted: string[]): void {
	for (const file of files) {
		if (!accepted.includes(file.type)) {
			throw new Error(
				`${file.name}: this file type is not supported by the selected model and endpoint.`,
			);
		}
		if (!file.size) {
			throw new Error(`${file.name}: the file is empty.`);
		}
	}
}

export async function readAttachments(
	files: File[],
	accepted: string[],
): Promise<FileUIPart[]> {
	validateAttachments(files, accepted);
	return Promise.all(
		files.map(
			(file) =>
				new Promise<FileUIPart>((resolve, reject) => {
					const reader = new FileReader();
					reader.onerror = () =>
						reject(reader.error ?? new Error(`Could not read ${file.name}.`));
					reader.onabort = () =>
						reject(new Error(`Reading ${file.name} was cancelled.`));
					reader.onload = () => {
						if (typeof reader.result !== "string") {
							reject(new Error(`Could not read ${file.name}.`));
							return;
						}
						resolve({
							type: "file",
							filename: file.name,
							mediaType: file.type,
							url: reader.result,
						});
					};
					reader.readAsDataURL(file);
				}),
		),
	);
}
