import type { DashboardRole } from "./roles.ts";

/** Virtual key info needed for auth/scope/limits (a cacheable subset of the row). */
export interface VirtualKeyAuth {
	id: string;
	name: string;
	/** Allowed public models. [] = all. */
	allowedModels: string[];
	enabled: boolean;
	/** ISO string or null. */
	expiresAt: string | null;
	maxBudgetCents: number | null;
	budgetReset: "hourly" | "daily" | "weekly" | "monthly" | null;
	budgetResetAt: string | null;
	spendCents: number;
	tpm: number | null;
	rpm: number | null;
}

/** A human operator's live session. */
export interface SessionAuth {
	sessionId: string;
	/** NULL for the environment-backed root operator, which has no user row. */
	userId: string | null;
	role: DashboardRole;
	isRoot: boolean;
}

/**
 * A realtime client secret (`ek_…`) stands in for the key that minted it, for one purpose only:
 * opening `/v1/realtime` sessions, starting from the session configuration attached to it.
 */
export interface RealtimeSecretGrant {
	/** The `session` given when the secret was minted, or null. */
	session: Record<string, unknown> | null;
}

export type Auth =
	| { type: "master"; realtimeSecret?: RealtimeSecretGrant }
	| {
			type: "virtual";
			key: VirtualKeyAuth;
			realtimeSecret?: RealtimeSecretGrant;
	  }
	| { type: "session"; session: SessionAuth };

/**
 * Stable identifier of whoever issued a request, for operation logs and the audit trail.
 * One of: "master-key", "root", "user:<uuid>", "key:<uuid>".
 */
export function actorOf(auth: Auth): string {
	switch (auth.type) {
		case "master":
			return "master-key";
		case "virtual":
			return `key:${auth.key.id}`;
		case "session":
			return auth.session.userId === null
				? "root"
				: `user:${auth.session.userId}`;
		default:
			throw new Error(
				`Unsupported auth type: ${(auth as { type: string }).type}`,
			);
	}
}

/** Typed variables of the Hono context. */
export interface AppEnv {
	Variables: {
		auth: Auth;
		requestId: string;
		operationId: string | undefined;
		turnRequestId: string | undefined;
		turnSignal: AbortSignal | undefined;
	};
}
