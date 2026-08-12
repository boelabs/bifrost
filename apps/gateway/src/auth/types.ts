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

export type Auth =
	| { type: "master" }
	| { type: "virtual"; key: VirtualKeyAuth };

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
