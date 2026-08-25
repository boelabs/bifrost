import * as z from "zod/v4";

const includeSchema = z
	.union([z.string(), z.array(z.string())])
	.transform((v) => (typeof v === "string" ? [v] : v));

const textFormatSchema = z.union([
	z.object({ type: z.literal("text") }).loose(),
	z.object({ type: z.literal("json_object") }).loose(),
	z
		.object({
			type: z.literal("json_schema"),
			name: z.string(),
			schema: z.record(z.string(), z.unknown()),
			description: z.string().optional(),
			strict: z.boolean().nullish(),
		})
		.loose(),
]);

const textConfigSchema = z
	.object({
		format: textFormatSchema.optional(),
	})
	.loose();

/**
 * Contract of the OpenResponses API (/v1/responses), compatible with OpenAI's Responses API.
 * Spec: https://www.openresponses.org/specification
 *
 * The `input`, `tools`, and `output` items are complex and evolve; we validate the top-level
 * fields and leave loose objects in the nested parts so as not to reject valid requests.
 * The contract is provider-agnostic: /v1/responses translates this request to the canonical type,
 * calls the adapter (chat), and renders the canonical result back to OpenResponses.
 */
export const responsesRequestSchema = z
	.object({
		model: z.string(),
		input: z
			.union([z.string(), z.array(z.record(z.string(), z.unknown()))])
			.optional(),
		instructions: z.string().nullish(),
		previous_response_id: z.string().nullish(),
		stream: z.boolean().optional().default(false),
		store: z.boolean().optional(),
		background: z.boolean().optional(),
		tools: z.array(z.record(z.string(), z.unknown())).optional(),
		tool_choice: z
			.union([z.string(), z.record(z.string(), z.unknown())])
			.optional(),
		parallel_tool_calls: z.boolean().optional(),
		reasoning: z.record(z.string(), z.unknown()).optional(),
		text: textConfigSchema.optional(),
		include: includeSchema.optional(),
		truncation: z.string().optional(),
		max_output_tokens: z.int().optional(),
		max_tool_calls: z.int().optional(),
		temperature: z.number().optional(),
		top_p: z.number().optional(),
		presence_penalty: z.number().optional(),
		frequency_penalty: z.number().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		service_tier: z.string().optional(),
		stream_options: z.record(z.string(), z.unknown()).optional(),
		safety_identifier: z.string().optional(),
		prompt_cache_key: z.string().optional(),
		top_logprobs: z.int().optional(),
		user: z.string().optional(),
		plugins: z.array(z.record(z.string(), z.unknown())).optional(),
		extra_body: z.record(z.string(), z.unknown()).optional(),
		/** Server-side conversation objects: accepted standalone, but not combinable with previous_response_id. */
		conversation: z.unknown().optional(),
		context_management: z.array(z.record(z.string(), z.unknown())).optional(),
		/** Prompt templates (registry-backed): not supported by this gateway. */
		prompt: z.unknown().optional(),
	})
	.loose()
	.refine((d) => d.input !== undefined || d.previous_response_id != null, {
		error: "Either 'input' or 'previous_response_id' is required",
		path: ["input"],
	})
	.refine((d) => d.background !== true, {
		error: "Background mode is not supported; use synchronous requests",
		path: ["background"],
	})
	.refine((d) => d.prompt === undefined, {
		error:
			"Prompt templates are not supported; inline your 'input' and 'instructions' instead",
		path: ["prompt"],
	})
	.refine((d) => !(d.conversation != null && d.previous_response_id != null), {
		error: "'conversation' cannot be combined with 'previous_response_id'",
		path: ["conversation"],
	})
	.refine((d) => d.conversation == null, {
		error:
			"Conversation objects are not supported; use previous_response_id for gateway-managed state",
		path: ["conversation"],
	});

export type ResponsesRequest = z.infer<typeof responsesRequestSchema>;

const webSocketResponseCreateEnvelopeSchema = z
	.object({
		type: z.literal("response.create"),
		generate: z.boolean().optional().default(true),
	})
	.loose();

export interface WebSocketResponseCreate {
	request: ResponsesRequest;
	generate: boolean;
}

/**
 * Parses the client event used by Responses WebSocket mode. Transport-only HTTP fields are rejected,
 * while the remaining body stays exactly on the normal Responses request contract.
 */
export function parseWebSocketResponseCreate(
	value: unknown,
): WebSocketResponseCreate {
	const envelope = webSocketResponseCreateEnvelopeSchema.parse(value);
	const raw = value as Record<string, unknown>;
	for (const field of ["stream", "stream_options", "background"] as const) {
		if (Object.hasOwn(raw, field)) {
			throw new z.ZodError([
				{
					code: "custom",
					path: [field],
					message: `'${field}' must not be sent in WebSocket response.create messages`,
				},
			]);
		}
	}
	const { type: _type, generate, ...body } = envelope;
	return {
		request: responsesRequestSchema.parse({ ...body, stream: true }),
		generate,
	};
}

export const compactResponseRequestSchema = z
	.object({
		model: z.string(),
		input: z
			.union([z.string(), z.array(z.record(z.string(), z.unknown()))])
			.optional(),
		previous_response_id: z.string().nullish(),
		instructions: z.string().nullish(),
		prompt_cache_key: z.string().max(64).optional(),
	})
	.strict()
	.refine(
		(data) => data.input !== undefined || data.previous_response_id != null,
		{
			error: "Either 'input' or 'previous_response_id' is required",
			path: ["input"],
		},
	);

export type CompactResponseRequest = z.infer<
	typeof compactResponseRequestSchema
>;
