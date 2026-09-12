import type { PublicEndpoint } from "./api.ts";
import { z } from "zod";

export const REASONING_EFFORTS = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ParameterConstraint {
	min?: number;
	max?: number;
	values?: Array<string | number | boolean>;
}

export interface PlaygroundCapabilities {
	supportedParameters: string[];
	inputModalities: string[];
	parameterConstraints: Record<string, ParameterConstraint>;
	reasoningEfforts: ReasoningEffort[];
	maxOutputTokens?: number;
}

export interface PlaygroundModel extends PlaygroundCapabilities {
	id: string;
	endpoints: PublicEndpoint[];
	acceptsImages: boolean;
}

const endpointPaths: Record<PublicEndpoint, string> = {
	"chat.completions": "/v1/chat/completions",
	responses: "/v1/responses",
	messages: "/v1/messages",
};
const endpoints = ["chat.completions", "responses", "messages"] as const;
const constraintSchema = z.object({
	min: z.number().optional(),
	max: z.number().optional(),
	values: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
const publicModelsSchema = z.object({
	data: z.array(
		z.object({
			id: z.string().min(1),
			operations: z.array(
				z.object({ id: z.string(), endpoints: z.array(z.string()) }),
			),
			supported_parameters: z.array(z.string()).optional(),
			architecture: z
				.object({ input_modalities: z.array(z.string()).optional() })
				.optional(),
			text_capabilities: z
				.object({
					contracts: z.array(z.string()),
					supported_parameters: z.array(z.string()),
					input_modalities: z.array(z.string()),
					parameter_constraints: z.record(z.string(), constraintSchema),
					reasoning_efforts: z.array(z.enum(REASONING_EFFORTS)),
					max_output_tokens: z.number().int().positive().optional(),
				})
				.optional(),
		}),
	),
});

export function parsePublicModels(body: unknown): PlaygroundModel[] {
	return publicModelsSchema
		.parse(body)
		.data.flatMap((model): PlaygroundModel[] => {
			const text = model.operations.find(
				(operation) => operation.id === "text.generate",
			);
			if (!text) return [];
			const capabilities = model.text_capabilities;
			const available = endpoints.filter(
				(endpoint) =>
					text.endpoints.includes(endpointPaths[endpoint]) &&
					(capabilities?.contracts.includes(endpoint) ?? true),
			);
			if (!available.length) return [];
			// Older catalogs only provide a union: do not infer safe optional controls or attachments.
			const inputModalities = capabilities?.input_modalities ?? ["text"];
			const parameterConstraints: Record<string, ParameterConstraint> = {};
			for (const [name, constraint] of Object.entries(
				capabilities?.parameter_constraints ?? {},
			)) {
				parameterConstraints[name] = {
					...(constraint.min !== undefined ? { min: constraint.min } : {}),
					...(constraint.max !== undefined ? { max: constraint.max } : {}),
					...(constraint.values !== undefined
						? { values: constraint.values }
						: {}),
				};
			}
			return [
				{
					id: model.id,
					endpoints: available,
					supportedParameters: capabilities?.supported_parameters ?? [],
					inputModalities,
					acceptsImages: inputModalities.includes("image"),
					parameterConstraints,
					reasoningEfforts: REASONING_EFFORTS.filter((effort) =>
						capabilities?.reasoning_efforts.includes(effort),
					),
					...(capabilities?.max_output_tokens !== undefined
						? { maxOutputTokens: capabilities.max_output_tokens }
						: {}),
				},
			];
		})
		.sort((a, b) => a.id.localeCompare(b.id));
}

const endpointParameters: Record<PublicEndpoint, readonly string[]> = {
	"chat.completions": [
		"temperature",
		"top_p",
		"max_tokens",
		"presence_penalty",
		"frequency_penalty",
		"seed",
		"stop",
		"reasoning",
		"reasoning_effort",
	],
	responses: [
		"temperature",
		"top_p",
		"max_tokens",
		"presence_penalty",
		"frequency_penalty",
		"reasoning",
		"reasoning_effort",
	],
	messages: [
		"temperature",
		"top_p",
		"top_k",
		"max_tokens",
		"stop",
		"reasoning",
		"reasoning_effort",
	],
};

export function supports(
	model: PlaygroundModel,
	parameter: string,
	endpoint?: PublicEndpoint,
): boolean {
	return (
		model.supportedParameters.includes(parameter) &&
		(endpoint === undefined ||
			(model.endpoints.includes(endpoint) &&
				endpointParameters[endpoint].includes(parameter)))
	);
}

export function capabilitiesFor(
	model: PlaygroundModel,
	endpoint: PublicEndpoint,
): PlaygroundCapabilities {
	if (!model.endpoints.includes(endpoint))
		return {
			supportedParameters: [],
			inputModalities: [],
			parameterConstraints: {},
			reasoningEfforts: [],
		};
	return {
		...model,
		supportedParameters: model.supportedParameters.filter((parameter) =>
			supports(model, parameter, endpoint),
		),
		inputModalities: model.inputModalities.filter((modality) =>
			[
				"text",
				"image",
				"pdf",
				...(endpoint === "chat.completions" ? ["audio"] : []),
			].includes(modality),
		),
	};
}

export function reasoningEffortsFor(
	model: PlaygroundModel,
	endpoint: PublicEndpoint,
): ReasoningEffort[] {
	return supports(model, "reasoning", endpoint) &&
		supports(model, "reasoning_effort", endpoint)
		? model.reasoningEfforts
		: [];
}

export const TUNABLE = [
	{
		key: "temperature",
		label: "Temperature",
		min: 0,
		max: 2,
		step: 0.05,
		fallback: 1,
	},
	{ key: "top_p", label: "Top P", min: 0, max: 1, step: 0.05, fallback: 1 },
	{ key: "top_k", label: "Top K", min: 1, max: 100, step: 1, fallback: 40 },
	{
		key: "max_tokens",
		label: "Max tokens",
		min: 1,
		max: 8192,
		step: 1,
		fallback: 1024,
	},
	{
		key: "presence_penalty",
		label: "Presence penalty",
		min: -2,
		max: 2,
		step: 0.05,
		fallback: 0,
	},
	{
		key: "frequency_penalty",
		label: "Frequency penalty",
		min: -2,
		max: 2,
		step: 0.05,
		fallback: 0,
	},
	{ key: "seed", label: "Seed", min: 0, max: 2147483647, step: 1, fallback: 0 },
] as const;
export type TunableKey = (typeof TUNABLE)[number]["key"];

export function parameterValues(
	model: PlaygroundModel,
	key: TunableKey,
): number[] {
	const constraint = model.parameterConstraints[key];
	return (
		constraint?.values?.filter(
			(value): value is number =>
				typeof value === "number" &&
				value >= (constraint.min ?? -Infinity) &&
				value <= (constraint.max ?? Infinity) &&
				(key !== "max_tokens" ||
					(value > 0 && value <= (model.maxOutputTokens ?? Infinity))),
		) ?? []
	);
}
export interface Tunable {
	key: TunableKey;
	label: string;
	min: number;
	max: number;
	step: number;
	fallback: number;
}

export function tunablesFor(
	model: PlaygroundModel,
	endpoint: PublicEndpoint,
): Tunable[] {
	return TUNABLE.flatMap((control): Tunable[] => {
		if (!supports(model, control.key, endpoint)) return [];
		const constraint = model.parameterConstraints[control.key];
		// Enumerations are not continuous slider ranges; omit rather than offer invalid intermediate values.
		if (constraint?.values !== undefined) return [];
		const min = Math.max(control.min, constraint?.min ?? control.min);
		const limit =
			control.key === "max_tokens" ? model.maxOutputTokens : undefined;
		const max = Math.min(
			constraint?.max ?? limit ?? control.max,
			limit ?? Infinity,
		);
		if (min > max) return [];
		return [
			{
				...control,
				min,
				max,
				fallback: Math.min(max, Math.max(min, control.fallback)),
			},
		];
	});
}
