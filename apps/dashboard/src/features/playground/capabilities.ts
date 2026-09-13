/**
 * What a model can be asked to do here, and in what order the picker offers it.
 *
 * One entry per operation the gateway exposes on a public endpoint. A model appears under every
 * capability it declares — a multimodal model is listed under Text and under Images, and picking it
 * from one group or the other is what says which of the two this session is about.
 *
 * Registration is deliberate: an operation is listed only once the playground can actually run it,
 * so the picker never offers a group that leads nowhere.
 */
export const CAPABILITIES = [
	{
		id: "text",
		operations: ["text.generate"],
		label: "Text",
		description: "Chat and completions",
	},
	{
		// Editing is the same workspace as generating — a prompt with source images rather than a
		// mode of its own — so a model that only edits still belongs in this group.
		id: "image",
		operations: ["image.generate", "image.edit"],
		label: "Images",
		description: "Generate and edit pictures",
	},
	{
		id: "embedding",
		operations: ["embedding.create"],
		label: "Embeddings",
		description: "Turn text into vectors",
	},
] as const;

export type Capability = (typeof CAPABILITIES)[number]["id"];

export const IMAGE_GENERATE = "image.generate";
export const IMAGE_EDIT = "image.edit";

export function capabilityLabel(capability: Capability): string {
	return (
		CAPABILITIES.find((entry) => entry.id === capability)?.label ?? capability
	);
}

export function isCapability(value: unknown): value is Capability {
	return CAPABILITIES.some((entry) => entry.id === value);
}
