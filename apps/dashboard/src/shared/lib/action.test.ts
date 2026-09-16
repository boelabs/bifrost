import { ApiError } from "#/shared/api/errors.ts";
import { redirect } from "next/navigation";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { attempt } from "./action.ts";

describe("attempt", () => {
	test("an answer the gateway gave on purpose comes back as a result", async () => {
		const result = await attempt(() => {
			throw new ApiError("Budget exhausted", { status: 402, code: "budget" });
		}, "The key could not be created.");

		assert.deepEqual(result, {
			ok: false,
			message: "Budget exhausted",
			status: 402,
			code: "budget",
		});
	});

	/**
	 * An expired session turns a write into `redirect("/auth")` (`shared/api/client.ts`), and that
	 * redirect travels as a thrown error. Packaged as a result it would reach the operator as a toast
	 * reading "NEXT_REDIRECT" and leave them on a page they can no longer use.
	 */
	test("a redirect belongs to the framework and is rethrown", async () => {
		await assert.rejects(
			attempt(() => redirect("/auth"), "The key could not be created."),
		);
	});
});
