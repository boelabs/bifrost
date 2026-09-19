import { gatewayForm, gatewayJson, type GatewayRequest } from "./gateway";
import { z } from "zod";

/**
 * Image generation and editing: one request, one set of pictures.
 *
 * Which of the two endpoints a run uses is decided by the run itself — a prompt alone is a
 * generation, a prompt with source images is an edit — rather than by a mode switch the operator
 * has to find first. A model that cannot edit simply never offers the attachment.
 */

export const IMAGE_SIZES = [
	"auto",
	"1024x1024",
	"1024x1536",
	"1536x1024",
	"512x512",
	"1792x1024",
	"1024x1792",
] as const;
export const IMAGE_QUALITIES = [
	"auto",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"standard",
	"hd",
] as const;
export const IMAGE_FORMATS = ["png", "jpeg", "webp"] as const;
export const IMAGE_BACKGROUNDS = ["auto", "transparent", "opaque"] as const;
export const IMAGE_STYLES = ["vivid", "natural"] as const;

/**
 * What the operator chose. `undefined` means "not chosen", and an unchosen field is left out of the
 * request entirely rather than sent as a default: the gateway validates every parameter against the
 * model's own profile, and a value nobody asked for is a rejection nobody asked for either.
 */
export interface ImageSettings {
	size?: string;
	quality?: string;
	n?: number;
	background?: string;
	outputFormat?: string;
	outputCompression?: number;
	style?: string;
}

export const emptyImageSettings = (): ImageSettings => ({});

export interface ImageRun {
	id: string;
	prompt: string;
	/** The source images an edit was run against, as data URLs, so the run reads on its own. */
	sources: string[];
	/** The same sources as files, so the run can be made again without re-attaching them. */
	files: File[];
	model: string;
	settings: ImageSettings;
	state: "running" | "completed" | "failed" | "stopped";
	images: GeneratedImage[];
	revisedPrompt?: string;
	error?: string;
	durationMs?: number;
	usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}

export interface GeneratedImage {
	url: string;
	mediaType: string;
}

const imagesResponse = z.object({
	created: z.number().optional(),
	data: z.array(
		z.object({
			b64_json: z.string().optional(),
			url: z.string().optional(),
			revised_prompt: z.string().optional(),
		}),
	),
	output_format: z.enum(IMAGE_FORMATS).optional(),
	usage: z
		.object({
			input_tokens: z.number().optional(),
			output_tokens: z.number().optional(),
			total_tokens: z.number().optional(),
		})
		.optional(),
});

export type ImagesResponse = z.infer<typeof imagesResponse>;

/** The managed fields, named as each endpoint names them. `size` has no meaning for an edit. */
function parameters(
	settings: ImageSettings,
	kind: "generate" | "edit",
): Record<string, string | number> {
	const entries: Record<string, string | number | undefined> = {
		quality: settings.quality,
		n: settings.n,
		background: settings.background,
		output_format: settings.outputFormat,
		output_compression: settings.outputCompression,
		...(kind === "generate"
			? { size: settings.size, style: settings.style }
			: {}),
	};
	return Object.fromEntries(
		Object.entries(entries).filter(
			(entry): entry is [string, string | number] => entry[1] !== undefined,
		),
	);
}

export function generationBody(
	model: string,
	prompt: string,
	settings: ImageSettings,
): Record<string, unknown> {
	return {
		model,
		prompt,
		...parameters(settings, "generate"),
		// The gateway hands back base64 either way; asking for it explicitly keeps a provider that
		// would rather return an expiring URL from doing so.
		response_format: "b64_json",
		stream: false,
	};
}

export function editForm(
	model: string,
	prompt: string,
	files: File[],
	settings: ImageSettings,
): FormData {
	const form = new FormData();
	form.set("model", model);
	form.set("prompt", prompt);
	for (const file of files) {
		form.append("image", file, file.name);
	}
	for (const [key, value] of Object.entries(parameters(settings, "edit"))) {
		form.set(key, String(value));
	}
	return form;
}

export function imagesFrom(response: ImagesResponse): GeneratedImage[] {
	const mediaType = `image/${response.output_format ?? "png"}`;
	return response.data.flatMap((entry) => {
		if (entry.b64_json) {
			return [{ url: `data:${mediaType};base64,${entry.b64_json}`, mediaType }];
		}
		return entry.url ? [{ url: entry.url, mediaType }] : [];
	});
}

export async function runImages(
	input: {
		model: string;
		prompt: string;
		files: File[];
		settings: ImageSettings;
	},
	options: GatewayRequest = {},
): Promise<ImagesResponse> {
	const body = input.files.length
		? await gatewayForm<unknown>(
				"/images/edits",
				editForm(input.model, input.prompt, input.files, input.settings),
				options,
			)
		: await gatewayJson<unknown>(
				"/images/generations",
				generationBody(input.model, input.prompt, input.settings),
				options,
			);
	return imagesResponse.parse(body);
}
