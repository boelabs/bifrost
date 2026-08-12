import type { CanonicalImageResponse } from "#core/images.ts";

/** Safe operation summary: never includes image bytes or base64 payloads. */
export function imageResponseLog(
	response: CanonicalImageResponse,
): Record<string, unknown> {
	return {
		created: response.created,
		images: response.data.map((image) => ({
			kind: "b64_json",
			mime_type: image.mimeType,
			width: image.width,
			height: image.height,
			bytes: image.b64Json
				? Math.floor((image.b64Json.length * 3) / 4)
				: undefined,
		})),
	};
}
