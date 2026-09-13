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
		operation: "text.generate",
		label: "Text",
		description: "Chat and completions",
	},
] as const;

export type Capability = (typeof CAPABILITIES)[number]["id"];

/** The catalog operation each capability is read from, for parsing a model's operation list. */
export const CAPABILITY_OPERATIONS: Record<Capability, string> =
	Object.fromEntries(
		CAPABILITIES.map((capability) => [capability.id, capability.operation]),
	) as Record<Capability, string>;

export function capabilityLabel(capability: Capability): string {
	return (
		CAPABILITIES.find((entry) => entry.id === capability)?.label ?? capability
	);
}

export function isCapability(value: unknown): value is Capability {
	return CAPABILITIES.some((entry) => entry.id === value);
}
