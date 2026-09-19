import type { CreateDeploymentInput } from "./common";
import * as z from "zod/v4";

export type CustomEntry = NonNullable<CreateDeploymentInput["catalogEntry"]>;

const objectSchema = z.record(z.string(), z.unknown());
const entrySchema = z
	.object({
		operations: z
			.record(z.string(), objectSchema)
			.refine(
				(operations) => Object.keys(operations).length > 0,
				"Select at least one operation.",
			),
	})
	.catchall(z.unknown());

export function parseObject(
	text: string,
	label: string,
): Record<string, unknown> | undefined {
	if (!text.trim()) {
		return undefined;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`${label} is not valid JSON.`);
	}
	const result = objectSchema.safeParse(value);
	if (!result.success) {
		throw new Error(`${label} must be a JSON object.`);
	}
	return result.data;
}

export function parseCustomEntry(text: string): CustomEntry {
	const result = entrySchema.safeParse(
		parseObject(text, "Custom configuration"),
	);
	if (!result.success) {
		throw new Error(
			"Custom configuration must contain at least one operation with an object profile.",
		);
	}
	return result.data;
}

export function objectValue(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? Object.fromEntries(Object.entries(value))
		: {};
}

export function operationTemplate(id: string): Record<string, unknown> {
	switch (id) {
		case "text.generate":
			return {
				capabilities: {
					tools: false,
					vision: false,
					reasoning: false,
					structuredOutputs: false,
				},
			};
		case "image.generate":
		case "image.edit":
			return {
				outputFormats: ["png"],
				responseFormats: ["b64_json"],
				sizes: { "1024x1024": {} },
			};
		case "video.generate":
			return { durations: ["5"], sizes: { "1280x720": {} } };
		case "audio.transcribe":
			return { responseFormats: ["json"] };
		case "embedding.create":
			return {};
		case "rerank":
			return { documentModalities: ["text"] };
		default:
			throw new Error(`Unsupported operation: ${id}`);
	}
}

export function initialCustomEntry(operationIds: string[]): CustomEntry {
	const first = operationIds.includes("text.generate")
		? "text.generate"
		: operationIds[0];
	return { operations: first ? { [first]: operationTemplate(first) } : {} };
}

export function updateProfile(
	entry: CustomEntry,
	id: string,
	patch: Record<string, unknown>,
): CustomEntry {
	const profile = { ...entry.operations[id], ...patch };
	return {
		...entry,
		operations: {
			...entry.operations,
			[id]: Object.fromEntries(
				Object.entries(profile).filter(([, value]) => value !== undefined),
			),
		},
	};
}

export function selectedTransports(
	entry: CustomEntry,
	transports: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(transports).filter(
			([id]) => entry.operations[id] !== undefined,
		),
	);
}
