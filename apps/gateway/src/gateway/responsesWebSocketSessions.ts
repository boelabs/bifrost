import type { DeploymentCandidate } from "./deploymentCandidates.ts";
import { adapterContextDiagnostics } from "#adapters/diagnostics.ts";
import type { CanonicalChatRequest } from "#core/canonical.ts";
import { observeChatStream } from "./streamLifecycle.ts";
import { GatewayError } from "#core/errors.ts";

import {
	remainingExecutionPolicy,
	traceUpstreamStream,
	type ChatExecResult,
	beforeFirstOutput,
	executeChat,
} from "./executor.ts";

import type {
	ResponsesWebSocketSession,
	AdapterContext,
} from "#adapters/types.ts";

interface UpstreamBinding {
	session: ResponsesWebSocketSession;
	latestPublicResponseId: string | null;
	latestUpstreamResponseId: string | null;
}

export class ResponsesWebSocketUpstreams {
	private readonly bindings = new Map<string, UpstreamBinding>();

	async execute(
		candidate: DeploymentCandidate,
		ctx: AdapterContext,
		request: CanonicalChatRequest,
		options: {
			currentRawInput: Record<string, unknown>[];
			previousPublicResponseId: string | null;
			generate: boolean;
		},
	): Promise<ChatExecResult> {
		const handler =
			ctx.transport === "responses"
				? candidate.adapter.responsesWebSocket
				: undefined;
		const localWarmup = (): ChatExecResult => {
			const diagnostics = adapterContextDiagnostics(ctx);
			diagnostics.terminal = { outcome: "completed", reason: "stop" };
			diagnostics.metadata = {
				...(diagnostics.metadata ?? {}),
				emptyOutputAllowed: true,
				generate: false,
			};
			async function* warmup() {
				yield {
					id: "",
					created: Math.floor(Date.now() / 1000),
					model: ctx.upstreamModel,
					choices: [
						{
							index: 0,
							delta: {},
							finishReason: "stop" as const,
						},
					],
					usage: {
						promptTokens: 0,
						completionTokens: 0,
						totalTokens: 0,
					},
				};
			}
			const observed = observeChatStream(
				warmup(),
				remainingExecutionPolicy(ctx),
				diagnostics,
			);
			return {
				kind: "stream",
				chunks: traceUpstreamStream(observed.items, ctx),
				observation: observed.observation,
			};
		};
		if (!handler) {
			if (!options.generate) {
				return localWarmup();
			}
			return executeChat(candidate.adapter, request, ctx);
		}

		let binding = this.bindings.get(candidate.row.id);
		if (!binding || binding.session.closed) {
			try {
				binding = {
					session: await beforeFirstOutput(handler.connect(ctx), ctx),
					latestPublicResponseId: null,
					latestUpstreamResponseId: null,
				};
			} catch {
				// Public WS remains provider-agnostic: an unavailable native socket degrades to the
				// existing canonical HTTP/SSE transport instead of breaking the client session.
				return options.generate
					? executeChat(candidate.adapter, request, ctx)
					: localWarmup();
			}
			this.bindings.set(candidate.row.id, binding);
		}
		const activeBinding = binding;

		const canContinue =
			options.previousPublicResponseId !== null &&
			activeBinding.latestPublicResponseId ===
				options.previousPublicResponseId &&
			activeBinding.latestUpstreamResponseId !== null;
		const upstreamRequest = canContinue
			? {
					...request,
					responsesTransport: {
						...(request.responsesTransport ?? {}),
						rawInput: options.currentRawInput,
					},
				}
			: request;
		let turn = await beforeFirstOutput(
			activeBinding.session.create(upstreamRequest, {
				...(canContinue
					? { previousResponseId: activeBinding.latestUpstreamResponseId! }
					: {}),
				generate: options.generate,
				signal: ctx.signal ?? AbortSignal.timeout(10 * 60 * 1000),
			}),
			ctx,
		);
		let resolveFinalId!: (id: string | null) => void;
		const finalUpstreamResponseId = new Promise<string | null>((resolve) => {
			resolveFinalId = resolve;
		});
		const session = activeBinding.session;
		const signal = ctx.signal ?? AbortSignal.timeout(10 * 60 * 1000);
		async function* chunks() {
			try {
				try {
					for await (const chunk of turn.chunks) yield chunk;
				} catch (error) {
					if (
						!canContinue ||
						!GatewayError.is(error) ||
						error.code !== "previous_response_not_found"
					)
						throw error;
					// The gateway still owns the complete canonical state. If OpenAI evicted its
					// connection-local id, retry once on the same socket with the full input.
					activeBinding.latestPublicResponseId = null;
					activeBinding.latestUpstreamResponseId = null;
					turn = await beforeFirstOutput(
						session.create(request, {
							generate: options.generate,
							signal,
						}),
						ctx,
					);
					for await (const chunk of turn.chunks) yield chunk;
				}
				resolveFinalId(await turn.upstreamResponseId);
				adapterContextDiagnostics(ctx).transportTerminator = "websocket_turn";
			} catch (error) {
				resolveFinalId(null);
				throw error;
			}
		}
		const observed = observeChatStream(chunks(), remainingExecutionPolicy(ctx));
		observed.observation.diagnostics = adapterContextDiagnostics(ctx);
		return {
			kind: "stream",
			chunks: traceUpstreamStream(observed.items, ctx),
			observation: observed.observation,
			upstreamResponseId: finalUpstreamResponseId,
		};
	}

	commit(
		deploymentId: string,
		publicResponseId: string,
		upstreamResponseId: Promise<string | null> | undefined,
	): void {
		for (const [id, other] of this.bindings) {
			if (id === deploymentId) continue;
			other.session.close();
			this.bindings.delete(id);
		}
		const binding = this.bindings.get(deploymentId);
		if (!binding || !upstreamResponseId) return;
		void upstreamResponseId.then((id) => {
			if (!id || binding.session.closed) return;
			binding.latestPublicResponseId = publicResponseId;
			binding.latestUpstreamResponseId = id;
		});
	}

	invalidate(publicResponseId: string): void {
		for (const binding of this.bindings.values()) {
			if (binding.latestPublicResponseId !== publicResponseId) continue;
			binding.latestPublicResponseId = null;
			binding.latestUpstreamResponseId = null;
		}
	}

	close(): void {
		for (const binding of this.bindings.values()) binding.session.close();
		this.bindings.clear();
	}
}
