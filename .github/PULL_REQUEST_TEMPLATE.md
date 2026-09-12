## Summary

<!-- What changes, and why. Two to five sentences. Link the issue if there is one. -->

**Type:** <!-- bug fix | feature | provider adapter | refactor | docs | breaking change -->

## Checklist

- [ ] `bun run check`, `bun run typecheck`, and `bun run test` pass locally
- [ ] Integration tests run if DB, router, rate limiting, or admin endpoints changed
      (`bun run --filter @boelabs/bifrost test:integration`)
- [ ] Tests added or updated for the change
- [ ] `openapi.yaml` regenerated if any OpenAPI Zod schema changed (`openapi:generate`)
- [ ] Migration added instead of edited if the schema changed (forward-only)
- [ ] Docs updated if behavior or the public contract changed
- [ ] English only, no unrelated formatter churn, no secrets or production connection strings

## Notes for reviewers

<!-- Trade-offs, risks, follow-ups, anything needing special attention. Delete if none. -->

<!--
Merging: `main` is branch-protected. Wait for all CI checks to pass and
`mergeStateStatus: CLEAN`, then squash-merge. Never merge on a red or pending CI.
-->
