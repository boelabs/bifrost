import type { components } from "#/shared/api/schema";

/**
 * The operator vocabulary, in a module with no runtime weight at all — `schema` is a `.d.ts`.
 *
 * Client components need these types (the shell decides what to render from the permission list),
 * and `features/auth/api.ts` cannot give them one: it reads cookies through `next/headers` and would
 * drag the server into the browser bundle.
 */
export type OperatorIdentity = components["schemas"]["OperatorIdentity"];
export type Permission = components["schemas"]["Permission"];
export type Role = OperatorIdentity["user"]["role"];
