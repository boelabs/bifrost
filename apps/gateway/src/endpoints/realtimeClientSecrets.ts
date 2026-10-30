import { getVirtualKeyById } from "#db/repos/virtualKeys.ts";
import { mintRealtimeSecret } from "#auth/realtimeSecrets.ts";
import { assertFinalModelAllowed } from "./runtime/pipeline.ts";
import { GatewayError } from "#core/errors.ts";
import { getAuth } from "#auth/middleware.ts";
import type { AppEnv } from "#auth/types.ts";
import type { Context } from "hono";
import { z } from "zod/v4";

import {
	realtimeTranscriptionSessionSchema,
	RealtimeClientEventError,
	newRealtimeSessionState,
	applySessionUpdate,
	renderSession,
} from "#contracts/openai/realtime.ts";

import {
	realtimeConversationSessionSchema,
	applyConversationSessionUpdate,
	newRealtimeConversationState,
	renderConversationSession,
	conversationConfigOf,
} from "#contracts/openai/realtimeConversation.ts";

/**
 * POST /v1/realtime/client_secrets — mints a short-lived `ek_…` key for a browser or app to open
 * `/v1/realtime` with, so the real key never leaves the backend. The secret carries the key's
 * permissions and limits, and optionally the session configuration it starts from.
 */

const DEFAULT_SECONDS = 600;

const requestSchema = z.object({
	expires_after: z
		.object({
			anchor: z.literal("created_at").optional(),
			seconds: z.int().min(10).max(7200),
		})
		.optional(),
	session: z
		.discriminatedUnion("type", [
			realtimeConversationSessionSchema,
			realtimeTranscriptionSessionSchema,
		])
		.optional(),
});

function badRequest(message: string, param: string | null): GatewayError {
	return new GatewayError({
		class: "bad_request",
		code: "invalid_value",
		message,
		publicMessage: message,
		...(param ? { param } : {}),
	});
}

/** The session the secret starts from, rendered as OpenAI does, after checking what can be. */
function renderedSession(
	c: Context<AppEnv>,
	session: z.infer<typeof requestSchema>["session"],
): Record<string, unknown> {
	try {
		if (session?.type === "transcription") {
			const state = applySessionUpdate(newRealtimeSessionState(), session);
			const model = state.transcription?.model;
			if (model) {
				assertFinalModelAllowed(c, model);
			}
			return renderSession(state);
		}
		const model = session?.model ?? "";
		const state = applyConversationSessionUpdate(
			newRealtimeConversationState(model),
			session ?? { type: "realtime" },
			null,
		);
		if (model) {
			assertFinalModelAllowed(c, model);
			conversationConfigOf(state);
		}
		return renderConversationSession(state);
	} catch (error) {
		if (error instanceof RealtimeClientEventError) {
			throw badRequest(error.message, error.param);
		}
		throw error;
	}
}

export async function realtimeClientSecretsHandler(c: Context<AppEnv>) {
	const auth = getAuth(c);
	if (auth.type === "session") {
		throw new GatewayError({
			class: "permission",
			message: "Client secrets are minted with an API key",
		});
	}
	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		throw badRequest("The request body must be JSON.", null);
	}
	const parsed = requestSchema.safeParse(body ?? {});
	if (!parsed.success) {
		const [issue] = parsed.error.issues;
		const param = issue?.path.map(String).join(".") || null;
		throw badRequest(
			`Invalid '${param ?? "body"}': ${issue?.message ?? "invalid value"}.`,
			param,
		);
	}
	const session = renderedSession(c, parsed.data.session);
	let keyHash: string | null = null;
	if (auth.type === "virtual") {
		const row = await getVirtualKeyById(auth.key.id);
		if (!row) {
			throw new GatewayError({ class: "auth", message: "Invalid API key" });
		}
		({ keyHash } = row);
	}
	const { value, expiresAt } = await mintRealtimeSecret(
		{ keyHash, session: parsed.data.session ?? null },
		parsed.data.expires_after?.seconds ?? DEFAULT_SECONDS,
	);
	return c.json({
		value,
		expires_at: expiresAt,
		session: { ...session, expires_at: expiresAt },
	});
}
