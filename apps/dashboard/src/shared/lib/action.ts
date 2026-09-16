import { unstable_rethrow as rethrowFrameworkError } from "next/navigation";
import { ApiError } from "#/shared/api/errors.ts";

/**
 * What a Server Action gives back.
 *
 * Actions cannot simply let a failure propagate: Next replaces a thrown error's message with a
 * generic one in production builds, and the whole point of the gateway's error envelope is that it
 * carries a sentence written for the operator ("budget exhausted", "a deployment with that name
 * already exists"). So every action returns its outcome instead of throwing it, and the message
 * survives the trip to the browser.
 *
 * A *bug* — a null dereference in this code, not a rejection from the gateway — is still thrown, and
 * still reaches the nearest error boundary. This envelope is for answers the gateway gave on purpose.
 */
export type ActionResult<T> =
	| { ok: true; data: T }
	| { ok: false; message: string; status: number | null; code: string | null };

/**
 * Runs a gateway call and packages the result. `fallback` is the sentence to show when the failure
 * carries no message of its own.
 */
export async function attempt<T>(
	run: () => Promise<T>,
	fallback: string,
): Promise<ActionResult<T>> {
	try {
		return { ok: true, data: await run() };
	} catch (cause) {
		/**
		 * `redirect()` and `notFound()` travel as thrown errors, and Next is the only thing that may
		 * catch them. An expired session turns a write into a redirect to the login screen
		 * (`shared/api/client.ts`); packaged as a result it would reach the operator as a toast
		 * reading "NEXT_REDIRECT" and go nowhere.
		 */
		rethrowFrameworkError(cause);
		if (cause instanceof ApiError)
			return {
				ok: false,
				message: cause.message,
				status: cause.status,
				code: cause.code,
			};
		if (cause instanceof Error && cause.message)
			return { ok: false, message: cause.message, status: null, code: null };
		return { ok: false, message: fallback, status: null, code: null };
	}
}

/** An action that reports success but has nothing to hand back. */
export type VoidResult = ActionResult<null>;
