import * as z from "zod/v4";

const outputConfigSchema = z
	.object({
		effort: z.unknown().optional(),
		format: z
			.object({
				type: z.literal("json_schema"),
				schema: z.record(z.string(), z.unknown()),
			})
			.loose()
			.nullish(),
	})
	.loose();

/**
 * PUBLIC contract of the Anthropic Messages API (POST /v1/messages). Like /v1/responses, it is
 * provider-agnostic: the request is translated to the canonical type, routed to any adapter with a
 * `chat` handler, and the canonical result is rendered back to the Anthropic format.
 *
 * (The anthropic ADAPTER speaks this transport TOWARD the provider; this ENDPOINT exposes it to the client.)
 */
export const messagesRequestSchema = z
	.object({
		model: z.string(),
		max_tokens: z.int().positive(), // required by Anthropic
		messages: z
			.array(
				z
					.object({
						role: z.enum(["user", "assistant"]),
						content: z.union([
							z.string(),
							z.array(z.record(z.string(), z.unknown())),
						]),
					})
					.loose(),
			)
			.min(1),
		system: z
			.union([z.string(), z.array(z.record(z.string(), z.unknown()))])
			.optional(),
		stream: z.boolean().optional().default(false),
		temperature: z.number().optional(),
		top_p: z.number().optional(),
		top_k: z.int().optional(),
		stop_sequences: z.array(z.string()).optional(),
		tools: z.array(z.record(z.string(), z.unknown())).optional(),
		tool_choice: z.record(z.string(), z.unknown()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		thinking: z.record(z.string(), z.unknown()).optional(),
		output_config: outputConfigSchema.optional(),
		extra_body: z.record(z.string(), z.unknown()).optional(),
	})
	.loose();

export type MessagesRequest = z.infer<typeof messagesRequestSchema>;
