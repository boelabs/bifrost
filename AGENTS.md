# AGENTS.md

Operating manual for AI coding agents in this repository. Humans start with
[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

Read this file top to bottom before your first change. The rules here override defaults.

## 1. Ground rules

- **Repository language: English only** — code, comments, identifiers, branches, commits, PRs, and
  docs.
- **Conversation language follows the user.** Reply in the language the user is using unless they
  ask otherwise.
- **Be concise.** Low verbosity everywhere: commit subjects, PR bodies, code comments, and your
  replies. Say what changed and why it matters; drop preamble, restatement, and summaries of work
  the diff already shows.
- **Never sign your work as an agent.** No `claude/`, `codex/`, `ai/`, `bot/` branch prefixes; no
  model or tool names in branch names, commit subjects or bodies, PR titles or descriptions; no
  `Co-Authored-By` bot trailers and no "generated with" footers. The repository history must read as
  the team's work. This applies to every artifact you create.
- **One feature per branch and per PR.** If the working tree mixes concerns, split it first.
- **Stay in scope.** Fix what was asked. Note adjacent problems in the PR body instead of bundling
  them.
- **Never weaken a gate** to make it pass — not the TypeScript config, not Biome rules, not a test
  assertion, not a CI step.

## 2. What this is

Bifrost — a backend-only, provider-agnostic AI gateway. Public endpoints are OpenAI-shaped
(`/v1/chat/completions`, `/v1/responses`, `/v1/images/*`, `/v1/embeddings`,
`/v1/audio/transcriptions`, `/v1/videos`, `/v1/rerank`) plus an Anthropic-compatible `/v1/messages`.
Every request is translated through one canonical core and routed to a provider adapter.

`GET /v1/models` and `GET /v1/models/{model}` are deliberately **unauthenticated**, like other
providers' public catalogs; `GET /v1/models/{model}/deployments` requires auth, because
per-deployment weights, limits, and live metrics are operator detail. None of the three ever expose
deployment labels, credentials, database ids, or upstream model ids.
See [Model discovery](apps/docs/content/docs/models-discovery.mdx).

Monorepo — Turborepo on Bun workspaces:

- `apps/gateway` — the service, **runs on Bun**. Package `@boelabs/bifrost`.
- `apps/docs` — documentation site (Next.js + Fumadocs, MDX). Served on Node (`next start`).
- `packages/tsconfig` — shared strict TypeScript config (`@boelabs/tsconfig`).

## 3. Commands

From the repo root:

| Task | Command |
|---|---|
| Install | `bun install` |
| Dev (all) | `bun run dev` |
| Lint + format check (the gate) | `bun run check` |
| Auto-fix formatting + import order | `bun run format` |
| Typecheck | `bun run typecheck` |
| Unit tests | `bun run test` |

Gateway-only: `bun run --filter @boelabs/bifrost <script>` — `dev`, `start`, `db:generate`,
`db:migrate`, `db:studio`, `test:integration`, `test:all`, `catalog:validate`,
`catalog:sync[:verify]`, `catalog:sync:vercel[:write|:verify]`, `encryption:rotate`,
`openapi:generate`.

**Before finishing any change**: `bun run check`, `bun run typecheck`, `bun run test`. If you
touched the database, router, rate limiting, or admin endpoints, also `test:integration` (needs a
real Postgres + Redis).

A single test file needs the test env — plain `bun test <file>` fails with "Invalid environment
variables". From `apps/gateway`:

```bash
bun test --preload ./tests/support/unitSetup.ts src/router/strategies.test.ts
```

## 4. Conventions

- **Runtime is Bun**, not Node. `node:*` imports and `process`/`Buffer` are fine (Bun implements
  them), but the app is never executed with the `node` binary.
- **Biome is the single source of truth** for formatting and lint (tabs, double quotes). Don't
  hand-format; run `bun run format`. `organizeImports` is intentionally **off** — import order is
  owned by `scripts/sort-imports.ts` (folded into `bun run format`), sorting by length, descending.
  Biome also formats **JSON**, including every `catalog.json`; if you edit those by hand or by
  script, run `bun run check` before finishing (CI runs it with `--error-on-warnings`, and
  serializer output like multi-line short arrays fails the gate even when the data is correct).
- **`apps/gateway/openapi.yaml` is generated, never hand-edited.** It comes from the Zod schemas in
  `src/openapi/` via `openapi:generate`, and a unit test fails when the committed file drifts. If
  you touch `src/openapi/components.ts`/`document.ts` — or any Zod schema they re-export —
  regenerate and commit the YAML in the same change.
- **Types are strict** (`packages/tsconfig/base.json`: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, …). Fix the types; do not relax the config.
- **Tests are colocated** as `*.test.ts` and must not hit the network —
  `tests/support/noRealFetch.ts` blocks real `fetch`; stub upstreams with `withStubbedFetch()`.

## 5. Architecture — keep the layering intact

```
contracts/  → public request/response shapes (OpenAI, Anthropic)
core/       → provider-agnostic canonical hub (the "unified" format)
adapters/   → upstream provider protocols (one dir per provider, each with its catalog.json)
endpoints/  → HTTP handlers (+ endpoints/runtime/ for shared per-request plumbing)
```

Adapters translate **to/from** the canonical format and must **never leak provider-specific fields
into `core`**. The canonical vocabulary is fixed — see the
[glossary](apps/docs/content/docs/glossary.mdx).

Chat request path: endpoint → canonical request → `router/` picks a deployment (strategy, cooldowns,
fallbacks; per-deployment latency/throughput state in `router/state.ts`) → `gateway/` executes
against the adapter. Model metadata (capabilities, limits, reasoning spec, pricing) resolves from
`catalog/` + `profiles/`; per-parameter support is enforced by
`endpoints/runtime/parameterPolicy.ts` according to the operator's `unsupportedParameterStrategy`
(`drop`/`error`/`allow`).

## 6. Database & migrations (Drizzle)

`apps/gateway/src/db/schema.ts` is the source of truth. Change it, then:

```bash
bun run --filter @boelabs/bifrost db:generate   # drizzle-kit, emits a migration
bun run --filter @boelabs/bifrost db:migrate    # applies pending
```

- Migrations are **forward-only** — never edit an applied migration; add a new one.
- Historical migrations contain hand-tuned DDL and stay immutable even after a later migration
  removes the structure; snapshots describe the schema at each point in time.
- `pgEnum`s must be **`export const`** or drizzle-kit won't emit their `CREATE TYPE`.
- `src/db/migrations/**` is excluded from Biome (drizzle owns its formatting).

## 7. Adding a provider or model

A new provider touches **four** files: the adapter `index.ts`, its `catalog.json`,
`PROVIDER_REGISTRATIONS` in `src/adapters/index.ts`, and the list in `scripts/validate-catalog.ts`
(forget the last and CI never validates the new catalog). Step by step:
[model catalog → Adding catalog entries](apps/docs/content/docs/model-catalog.mdx#adding-catalog-entries).

Catalog entries are **deliberately minimal**: only `operations` and `pricing` (what the runtime
consumes) plus `deprecated`, `notes`, and `needsHumanReview`. The loader rejects unknown fields — do
not add descriptive metadata (names, lifecycle dates, modality lists, provenance); it was removed on
purpose.

**Catalog sync.** `apps/gateway/src/catalog/sync/` (CLI: `catalog:sync[:verify]`) is a **local,
report-only** tool — it never writes to any `catalog.json` and has no CI automation. It
cross-references Vercel AI Gateway and OpenRouter (plus models.dev for enrichment) and writes
`apps/gateway/.source/catalog-sync/REPORT.md` + `report.json` (gitignored): drafted entries for new
models, stale pricing/context/limit essentials, models no longer listed upstream, and numeric
conflicts between sources. A human applies what they agree with; `operations` details are always
human work. `--mode verify` exits non-zero when the report is non-empty.

Reasoning specs are a special case: no source expresses *how* a model controls reasoning
(`ReasoningSpec.kind`/`levels`/`budgets`), so drafts built from models.dev carry
`needsHumanReview: [...]`, and `scripts/validate-catalog.ts` **fails the build** while any entry has
a non-empty marker. Verify against the provider's docs and clear it before merging.

Vercel's adapter catalog is the deliberate exception: `scripts/vercel-catalog-sync.ts`
deterministically generates `src/adapters/vercel/catalog.json` from Vercel's public `/v1/models`.
Use `catalog:sync:vercel` for a candidate, `:write` to update the snapshot, `:verify` for drift.

## 8. Git workflow

### Branches

Branch off up-to-date `main`, named for the change — never for the tool that made it:

```
feat/responses-image-detail      good
fix/cooldown-reset-on-success    good
docs/routing-fallbacks           good
codex/…  claude/…  ai/…          forbidden
```

### Commits

Imperative mood, one line, no trailing period, no scope theater. Conventional Commit prefixes are
welcome but not required. A body is only for context the subject can't carry (why, trade-offs,
follow-ups) — keep it to a few lines. No agent attribution of any kind (see §1).

```
Default Responses image detail to auto
Fix cooldown reset on success
```

### Pull requests

- Fill in [`.github/PULL_REQUEST_TEMPLATE.md`](.github/PULL_REQUEST_TEMPLATE.md) — summary, type,
  checklist, reviewer notes. Tick only boxes that are actually true; delete inapplicable lines
  rather than leaving them ambiguous.
- Keep the body short. Two to five sentences of summary is the target.
- Keep unrelated formatter churn out of the diff: `bun run format` may reorder imports in untouched
  files (pre-existing drift) — restore those from the base branch.

### Merging — the hard rule

**Never merge to `main` while CI is not green.** `main` is branch-protected; auto-merge is disabled
and admin bypass is off-limits. The required checks are the three CI jobs in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml): *Lint, typecheck & unit tests*,
*Integration tests*, and *Build container images*.

```bash
gh pr checks <number> --watch                       # wait for all checks
gh pr view <number> --json mergeStateStatus          # must be CLEAN
gh pr merge <number> --squash                        # only then
```

If a check fails, fix the branch and push — do not re-run to get a lucky pass, do not merge around
it, do not ask for the protection to be lifted.

### After a merge — clean up, always

Immediately after a squash-merge, return to a clean local state:

```bash
git checkout main
git pull --ff-only origin main
git remote prune origin
git branch --merged main | grep -vE '^\*|^\s*main$' | xargs -r git branch -d
```

Squash-merged branches don't register as merged, so also delete the branch you just landed
(`git branch -D <branch>`) and any other local branch whose PR is closed or merged — verify with
`gh pr list --state merged --limit 20` before deleting anything you didn't open. Never delete
`main`, and never force-delete a branch with unpushed work.

## 9. Live environments

Hosts, credentials, and runbooks for the environments we operate are **not in this repository**.
They live in `AGENTS.local.md`, which is gitignored — read it before touching a live environment,
and never quote or paste its contents into a commit, PR, issue, or any other shared artifact.

Regardless of environment: secrets are **used, never displayed**. Load them into a command's
environment or send them as headers; do not read, print, echo, log, or summarize a value. `.env*`
files stay out of git except `.env.example`.

## 10. Things that will bite you

- **Bun's TLS rejects self-signed Postgres/Redis certificates** (e.g. databases exposed on a raw
  Coolify/Dokploy port). Use a private network without TLS, or a public-CA certificate.
  See [Troubleshooting](apps/docs/content/docs/troubleshooting.mdx).
- **Background jobs run in-process**, not via cron: operation retention/reconciliation,
  `response_states` GC, extension reloads, and video polling/asset GC.
- **Integration tests** (`tests/integration/*.integration.test.ts`) need a real Postgres + Redis and
  run **one process per file** via `scripts/run-integration.ts` — they assume per-file isolation, and
  a shared `bun test` process leaks connections between files. They skip cleanly without the infra.
- **CI's lint gate is exactly `bun run check` from the repo root** — whole repo, same flags. A
  path-scoped `biome check <paths>` on the files you edited misses the ones your change regenerated
  or serialized, and those are what fail in CI.
