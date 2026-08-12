# AGENTS.md

Guidance for AI coding agents working in this repository. Humans should start with
[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md); this file is the quick, agent-focused
reference.

## What this is

Bifrost — a backend-only, provider-agnostic AI gateway. Public endpoints are OpenAI-shaped
(`/v1/chat/completions`, `/v1/responses`, `/v1/images/*`, `/v1/embeddings`, `/v1/audio/transcriptions`)
plus an Anthropic-compatible `/v1/messages`. `GET /v1/models` and `GET /v1/models/{model}` are
deliberately **unauthenticated**, like other providers' public catalogs; `GET /v1/models/{model}/deployments`
requires auth, since per-deployment weight/limits/live metrics are operator infrastructure detail, not
public model information. None of the three ever expose deployment labels, credentials, database ids,
or upstream model ids. Every request is translated through one canonical core and routed to provider
adapters. See [Model discovery](apps/docs/content/docs/models-discovery.mdx).

Monorepo — Turborepo on Bun workspaces:

- `apps/gateway` — the service. **Runs on Bun.** Package `@boelabs/bifrost`.
- `apps/docs` — documentation site (Next.js + Fumadocs, MDX). Served on Node (`next start`).
- `packages/tsconfig` — shared strict TypeScript config (`@boelabs/tsconfig`).

## Commands (run from the repo root)

| Task | Command |
|---|---|
| Install | `bun install` |
| Run everything (dev) | `bun run dev` |
| Lint + format check (the gate) | `bun run check` |
| Auto-fix formatting + sort imports | `bun run format` |
| Typecheck | `bun run typecheck` |
| Unit tests | `bun run test` |

Gateway-only scripts run with `bun run --filter @boelabs/bifrost <script>`: `dev`, `start`,
`db:generate`, `db:migrate`, `db:studio`, `test:integration`, `test:all`, `catalog:validate`,
`catalog:sync[:verify]`, `catalog:sync:vercel[:write|:verify]`, `encryption:rotate`, `openapi:generate`.

**Before you finish a change**, run `bun run check`, `bun run typecheck`, and `bun run test`. If you
touched the database, router, rate limiting, or admin endpoints, also run `test:integration` (needs a
real Postgres + Redis).

To run a **single test file**, plain `bun test <file>` fails with "Invalid environment variables"
(anything importing `#config/env.ts` needs the test env). Use the preload, from `apps/gateway`:

```bash
bun test --preload ./tests/support/unitSetup.ts src/router/strategies.test.ts
```

## Conventions

- **Language: English only** — code, comments, identifiers, commit messages, and docs. No exceptions.
- **Runtime is Bun**, not Node. Use `node:*` imports and `process`/`Buffer` freely (Bun implements
  them), but the app is never executed with the `node` binary.
- **Formatting/lint:** Biome is the single source of truth (tabs, double quotes). Don't hand-format;
  run `bun run format`. `organizeImports` is intentionally **off** — import order is owned by
  `scripts/sort-imports.ts` (folded into `bun run format`), which sorts by length, descending.
  Biome also formats **JSON**, including every `catalog.json` — if you edit those by hand or with a
  script, run `bun run check` before finishing (CI runs it with `--error-on-warnings`; serializer
  output like multi-line short arrays will fail the gate even when the data is correct).
- **`apps/gateway/openapi.yaml` is generated, never hand-edited.** It comes from the Zod schemas in
  `src/openapi/` via `openapi:generate`, and a unit test fails when the committed file drifts from the
  generator. If you touch `src/openapi/components.ts`/`document.ts` — or any Zod schema they re-export —
  regenerate and commit the YAML in the same change.
- **Types are strict** (`packages/tsconfig/base.json`: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, …). Do not weaken the config; fix the types.
- **Commits:** clear, imperative mood. Conventional Commit prefixes are welcome but not required.

## Architecture — keep the layering intact

```
contracts/  → public request/response shapes (OpenAI, Anthropic)
core/       → provider-agnostic canonical hub (the "unified" format)
adapters/   → upstream provider protocols (one dir per provider, each with its catalog.json)
endpoints/  → HTTP handlers (+ endpoints/runtime/ for shared per-request plumbing)
```

Adapters translate **to/from** the canonical format and must **never leak provider-specific fields
into `core`**. The canonical vocabulary is fixed — see the
[glossary](apps/docs/content/docs/glossary.mdx).

The request path for chat is: endpoint → canonical request → `router/` picks a deployment (strategy,
cooldowns, fallbacks; per-deployment latency/throughput state lives in `router/state.ts`) → `gateway/`
executes against the adapter. Model metadata (capabilities, limits, reasoning spec, pricing) resolves
from `catalog/` + `profiles/`, and per-parameter support is enforced by
`endpoints/runtime/parameterPolicy.ts` according to the operator's `unsupportedParameterStrategy`
(`drop`/`error`/`allow`).

## Database & migrations (Drizzle)

`apps/gateway/src/db/schema.ts` is the source of truth. Change it, then:

```bash
bun run --filter @boelabs/bifrost db:generate   # drizzle-kit, emits a migration
bun run --filter @boelabs/bifrost db:migrate    # Drizzle migrator, applies pending
```

Gotchas:

- Historical migrations contain hand-tuned DDL. They remain immutable even after a later migration
  removes the corresponding structure; generated snapshots describe the schema at each point in time.
- `pgEnum`s must be **`export const`** or drizzle-kit won't emit their `CREATE TYPE`.
- `src/db/migrations/**` is excluded from Biome (drizzle owns its formatting).
- Migrations are forward-only — **never edit an applied migration**; add a new one.

## Adding a provider or model

A new provider touches **four** files: the adapter `index.ts`, its `catalog.json`,
`PROVIDER_REGISTRATIONS` in `src/adapters/index.ts`, and the list in `scripts/validate-catalog.ts`
(forgetting the last means CI never validates the new catalog). Full step-by-step:
[model catalog → Adding catalog entries](apps/docs/content/docs/model-catalog.mdx#adding-catalog-entries).

Catalog entries are **deliberately minimal**: only `operations` and `pricing` (what the runtime
consumes) plus `deprecated`, `notes`, and `needsHumanReview`. The loader rejects anything else as an
unknown field — do not add descriptive metadata (names, lifecycle dates, modalities lists, provenance);
it was removed on purpose.

### Catalog sync

`apps/gateway/src/catalog/sync/` (CLI: `scripts/catalog-sync.ts`, `bun run catalog:sync[:verify]`) is a
**local, report-only** tool — it never writes to any `catalog.json`, and it deliberately has no CI
workflow or automation. It cross-references Vercel AI Gateway and OpenRouter (plus models.dev for
enrichment) and writes `apps/gateway/.source/catalog-sync/REPORT.md` + `report.json` (gitignored) with:
drafted entries for new models (ready to review and paste), stale pricing/context/limit essentials on
existing entries, models no longer listed upstream (deprecation candidates), and numeric conflicts
between sources. A human applies whatever they agree with by hand; `operations` details and everything
beyond the essentials are always human work. `--mode verify` exits non-zero if the report is non-empty
(a local drift check).

Reasoning specs are a special case: no source can express *how* a model controls reasoning
(`ReasoningSpec.kind`/`levels`/`budgets`), so drafts built from models.dev's `reasoning_options` carry
`needsHumanReview: [...]` on the entry. `scripts/validate-catalog.ts` **fails the build** while any entry
has a non-empty `needsHumanReview` — verify the draft against the provider's actual docs and clear the
marker before merging. Hand-edited catalog entries never carry this marker, so manual catalog work is
unaffected.

Vercel's own adapter catalog is the deliberate exception to the report-only rule. The dedicated
`scripts/vercel-catalog-sync.ts` reads Vercel's public `/v1/models` response and deterministically
generates `src/adapters/vercel/catalog.json`; use `catalog:sync:vercel` for a local candidate,
`:write` to update the committed snapshot, and `:verify` for a live drift check. It only emits
operation families implemented by the adapter and reports unsupported types and unrepresentable
pricing separately.

## Pull requests & CI

- `main` is **branch-protected**: nothing lands without the required CI checks passing (lint/typecheck/
  unit, integration tests, container image build). Auto-merge is disabled and admin bypass is off-limits
  — push, open the PR, wait for `mergeStateStatus: CLEAN`, then squash-merge.
- PRs are **squash-merged**, one feature per PR. If your working tree mixes features, split it into
  separate branches before opening anything.
- CI's lint gate is exactly `bun run check` from the repo root — same flags, **whole repo**. Don't
  substitute a path-scoped `biome check <paths>` limited to the files you edited: the gate also covers
  files your change regenerated or serialized (e.g. `catalog.json`), and those are the ones that fail
  in CI after passing your local spot-check.
- Keep unrelated formatter churn out of PRs: `bun run format` may reorder imports in files you didn't
  touch (pre-existing drift); restore those from the base branch to keep the diff focused.

## Things that will bite you

- **Bun's TLS rejects self-signed Postgres/Redis certificates** (e.g. databases exposed by a raw
  Coolify/Dokploy port). Connect over a private network without TLS, or use a managed provider with a
  public-CA certificate. See [Troubleshooting](apps/docs/content/docs/troubleshooting.mdx).
- **Background jobs run in-process**, not via cron: operation retention/reconciliation,
  `response_states` GC, extension reloads, and video polling/asset GC.
- **Integration tests** (`*.integration.test.ts` under `apps/gateway/tests/integration`) need a real
  Postgres + Redis. They are run **one process per file** via `scripts/run-integration.ts` because they
  assume per-file isolation; a single shared `bun test` process leaks connections between files. They
  skip cleanly when the infra is unavailable.
- **Tests must not hit the network.** `tests/support/noRealFetch.ts` blocks real `fetch`; stub
  upstreams with `withStubbedFetch()`. Unit tests are colocated as `*.test.ts` and run with `bun test`.
