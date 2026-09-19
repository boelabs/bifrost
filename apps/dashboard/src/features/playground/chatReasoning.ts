import type { LanguageModelMiddleware } from "ai";
import { z } from "zod";

const reasoningPart = z.object({
	id: z.string(),
	index: z.number().int().nonnegative(),
	status: z.enum(["streaming", "done"]),
});
const reasoningState = z.array(z.record(z.string(), z.json()));
const chunkSchema = z.object({
	choices: z.array(
		z.object({
			delta: z
				.object({
					provider_specific_fields: z
						.object({
							openai: z
								.object({
									reasoning: reasoningState.optional(),
									responses: z
										.object({ reasoning_part: reasoningPart.optional() })
										.optional(),
								})
								.optional(),
						})
						.optional(),
				})
				.optional(),
		}),
	),
});

/** The compatible SDK flattens reasoning; restore the gateway's item and summary boundaries. */
export const chatReasoningMiddleware: LanguageModelMiddleware = {
	transformParams: async ({ params }) => ({
		...params,
		includeRawChunks: true,
		prompt: params.prompt.map((message) => {
			if (message.role !== "assistant") {
				return message;
			}
			const states = message.content.flatMap((part) => {
				const parsed = reasoningState.safeParse(
					part.providerOptions?.bifrost?.reasoning,
				);
				return parsed.success ? parsed.data : [];
			});
			if (!states.length) {
				return message;
			}
			return {
				...message,
				providerOptions: {
					...message.providerOptions,
					openaiCompatible: {
						...message.providerOptions?.openaiCompatible,
						provider_specific_fields: { openai: { reasoning: states } },
					},
				},
			};
		}),
	}),
	wrapStream: async ({ doStream }) => {
		const result = await doStream();
		type Part =
			typeof result.stream extends ReadableStream<infer T> ? T : never;
		let pending: string | undefined;
		let active: string | undefined;
		let sequence = 0;
		const states = new Map<string, z.infer<typeof reasoningState>[number]>();
		const close = (controller: TransformStreamDefaultController<Part>) => {
			if (active !== undefined) {
				controller.enqueue({ type: "reasoning-end", id: active });
			}
			active = undefined;
		};
		return {
			...result,
			stream: result.stream.pipeThrough(
				new TransformStream<Part, Part>({
					transform(part, controller) {
						if (part.type === "raw") {
							const parsed = chunkSchema.safeParse(part.rawValue);
							if (parsed.success) {
								for (const state of parsed.data.choices[0]?.delta
									?.provider_specific_fields?.openai?.reasoning ?? []) {
									states.set(
										typeof state.id === "string"
											? state.id
											: JSON.stringify(state),
										state,
									);
								}
							}
							const boundary = parsed.success
								? parsed.data.choices[0]?.delta?.provider_specific_fields
										?.openai?.responses?.reasoning_part
								: undefined;
							if (boundary) {
								const key = `${boundary.id}:${boundary.index}`;
								if (
									active !== undefined &&
									(active !== key || boundary.status === "done")
								) {
									close(controller);
								}
								pending = key;
							}
							return;
						}
						if (part.type === "reasoning-start") {
							return;
						}
						if (part.type === "reasoning-delta") {
							if (active === undefined) {
								active = pending ?? `reasoning-${sequence++}`;
								controller.enqueue({ type: "reasoning-start", id: active });
							}
							controller.enqueue({ ...part, id: active });
							return;
						}
						if (part.type === "reasoning-end") {
							close(controller);
							pending = undefined;
							return;
						}
						if (part.type === "finish" || part.type === "error") {
							close(controller);
						}
						if (part.type === "finish" && states.size) {
							controller.enqueue({
								...part,
								providerMetadata: {
									...part.providerMetadata,
									bifrost: {
										...part.providerMetadata?.bifrost,
										reasoning: [...states.values()],
									},
								},
							});
							return;
						}
						controller.enqueue(part);
					},
				}),
			),
		};
	},
};
