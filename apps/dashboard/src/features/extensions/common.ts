import type { components } from "#/shared/api/schema";

/**
 * The extension vocabulary and the starter module, in a module with no server import — the tables
 * and dialogs on this page are Client Components, and `api.ts` reads cookies through `next/headers`.
 */
export type Artifact = components["schemas"]["ExtensionArtifact"];
export type Instance = components["schemas"]["ExtensionInstance"];

/**
 * The live view of the process answering this request — not stored configuration.
 *
 * An instance disabled by its breaker is disabled in THAT replica: the row in Postgres still says
 * enabled, and another replica may still be running it. The page has to say which of the two it is
 * showing, so the shape is kept separate from the instance rows rather than merged into them.
 */
export type RuntimeStatus = components["schemas"]["ExtensionRuntimeStatus"];
export type RuntimeInstance = RuntimeStatus["instances"][number];

export interface InstanceInput {
	id: string;
	definition: string;
	enabled?: boolean;
	critical?: boolean | null;
	priority?: number;
	match?: Record<string, unknown>;
	config?: unknown;
}

/**
 * A module that does nothing but show the shape. Offered as the starting point of a new artifact
 * because the alternative — an empty textarea and a link to the docs — is how an operator ends up
 * pasting something that fails to probe and learning nothing from the error.
 */
export const STARTER_MODULE = `import { defineExtension } from "#extensions/sdk.ts";

export default defineExtension({
  key: "example",
  version: "1",
  label: "Example",
  description: "Logs every request and response that passes through.",

  hooks: {
    // Runs on the canonical request, so one instance covers /v1/chat/completions,
    // /v1/responses and /v1/messages at once. Return the request to pass it on
    // (mutated or not); throwing here fails the request.
    onCanonicalRequest(ctx, request) {
      ctx.log.info("saw a request", {
        callType: ctx.callType,
        publicModel: ctx.publicModel,
      });
      return request;
    },

    // Runs once the operation produced a response.
    onCanonicalResponse(ctx, response) {
      ctx.log.info("saw a response", { requestId: ctx.requestId });
      return response;
    },
  },
});
`;

/**
 * The badge colour for the runtime as a whole. Lives here rather than beside the view because the
 * page is a Server Component and renders the badge itself — and a Server Component cannot read a
 * runtime value out of a `"use client"` module.
 */
export function runtimeTone(status: string): "success" | "warning" | "danger" {
	if (status === "ok") {
		return "success";
	}
	if (status === "degraded") {
		return "warning";
	}
	return "danger";
}
