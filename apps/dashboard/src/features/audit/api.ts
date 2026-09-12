import type { components, paths } from "#/shared/api/schema";
import { api, unwrap } from "#/shared/api/client.ts";

export type AuditEntry = components["schemas"]["AuditEntry"];

type AuditQuery = NonNullable<
	paths["/admin/audit"]["get"]["parameters"]["query"]
>;

export type AuditKind = NonNullable<AuditQuery["kind"]>;

/**
 * The trail is append-only, so there is no create, update or delete here — and there is none in the
 * gateway either. This module is a reader by design, not by omission.
 */
export async function listAudit(params?: AuditQuery) {
	return unwrap(await api.GET("/admin/audit", { params: { query: params } }));
}
