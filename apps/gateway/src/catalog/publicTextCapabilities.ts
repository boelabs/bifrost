import { supportedParameterNames } from "./parameters.ts";
import type { ResolvedModelMetadata } from "./types.ts";
import { EFFORT_ORDER } from "#core/reasoning.ts";

const TEXT_CONTRACTS = ["chat.completions", "responses", "messages"] as const;

interface PublicParameterConstraint {
	min?: number;
	max?: number;
	values?: Array<string | number | boolean>;
}

/** Common capabilities, not the catalog's optimistic union: requests use normal pool routing. */
export function publicTextCapabilities(metas: ResolvedModelMetadata[]) {
	const text = metas.filter((meta) => meta.operations?.["text.generate"]);
	if (!text.length) return undefined;
	const parameters = text.map(supportedParameterNames);
	const supported = (parameters[0] ?? []).filter((name) =>
		parameters.every((names) => names.includes(name)),
	);
	const constraints: Record<string, PublicParameterConstraint> = {};
	for (const name of supported) {
		const constraint: PublicParameterConstraint = {};
		for (const meta of text) {
			const entry = meta.operations?.["text.generate"]?.parameters?.[name];
			if (typeof entry !== "object") continue;
			if (entry.min !== undefined)
				constraint.min = Math.max(constraint.min ?? -Infinity, entry.min);
			if (entry.max !== undefined)
				constraint.max = Math.min(constraint.max ?? Infinity, entry.max);
			if (entry.values !== undefined)
				constraint.values = constraint.values
					? constraint.values.filter((value) => entry.values?.includes(value))
					: [...entry.values];
		}
		if (constraint.values)
			constraint.values = constraint.values.filter(
				(value) =>
					typeof value !== "number" ||
					(value >= (constraint.min ?? -Infinity) &&
						value <= (constraint.max ?? Infinity)),
			);
		if (Object.keys(constraint).length) constraints[name] = constraint;
	}
	const supportedParameters = supported.filter((name) => {
		const constraint = constraints[name];
		return (
			!constraint ||
			((constraint.min ?? -Infinity) <= (constraint.max ?? Infinity) &&
				constraint.values?.length !== 0)
		);
	});
	for (const name of Object.keys(constraints))
		if (!supportedParameters.includes(name)) delete constraints[name];
	const modalities = text.map(
		(meta) =>
			meta.operations?.["text.generate"]?.modalities?.input ??
			(meta.capabilities.vision ? ["text", "image"] : ["text"]),
	);
	const outputLimits = text.flatMap((meta) =>
		meta.maxOutputTokens === undefined ? [] : [meta.maxOutputTokens],
	);
	return {
		contracts: TEXT_CONTRACTS.filter((contract) =>
			text.every(
				(meta) =>
					meta.operations?.["text.generate"]?.contracts?.includes(contract) ??
					true,
			),
		),
		supported_parameters: supportedParameters,
		parameter_constraints: constraints,
		input_modalities: (modalities[0] ?? [])
			.filter((modality) =>
				modalities.every((inputs) => inputs.includes(modality)),
			)
			.sort(),
		reasoning_efforts: EFFORT_ORDER.filter(
			(effort) =>
				supportedParameters.includes("reasoning_effort") &&
				supportedParameters.includes("reasoning") &&
				text.every((meta) => meta.reasoning?.levels.includes(effort)),
		),
		...(outputLimits.length
			? { max_output_tokens: Math.min(...outputLimits) }
			: {}),
	};
}
