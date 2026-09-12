/**
 * The gateway's error vocabulary, kept free of any server import on purpose.
 *
 * Client components need `ApiError` to decide whether a failure carries a message worth showing
 * (see `shared/feedback/notifications.tsx`), while `shared/api/client.ts` — which reads the
 * visitor's cookies through `next/headers` — must never reach a browser bundle. Splitting the two
 * is what keeps that boundary honest.
 */

/** Shape of the gateway's error envelope (GatewayError.toOpenAI). */
export interface GatewayErrorBody {
	error: {
		message: string;
		type: string;
		param: string | null;
		code: string | null;
	};
}

export class ApiError extends Error {
	readonly status: number;
	readonly code: string | null;

	constructor(
		message: string,
		options: { status: number; code?: string | null },
	) {
		super(message);
		this.name = "ApiError";
		this.status = options.status;
		this.code = options.code ?? null;
	}
}

/**
 * Turns an openapi-fetch result into data or a thrown Error carrying the gateway's public message.
 * Every feature calls the API through this, so error handling is identical everywhere.
 */
export function unwrap<T>(result: {
	data?: T;
	error?: unknown;
	response: Response;
}): T {
	if (result.error !== undefined) throw toError(result.error, result.response);
	if (result.data === undefined)
		throw new ApiError("The gateway returned an empty response", {
			status: result.response.status,
		});
	return result.data;
}

function toError(error: unknown, response: Response): ApiError {
	const body = error as Partial<GatewayErrorBody>;
	const message =
		body?.error?.message ?? `Request failed with status ${response.status}`;
	return new ApiError(message, {
		status: response.status,
		code: body?.error?.code ?? null,
	});
}

/** True when a failure means "log in again" rather than "something went wrong". */
export function isUnauthenticated(error: unknown): boolean {
	return error instanceof ApiError && error.status === 401;
}
