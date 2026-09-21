# AGENTS.md

Operating manual for AI coding agents in this repository. Humans start with
[README.md](README.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

Read this file top to bottom before your first change. The rules here override defaults.

## 1. Ground rules

- **Repository language: English only** — code, comments, identifiers, branches, commits, PRs, and
  docs. Localized documentation may use its declared language; code examples and identifiers stay
  in English.
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
See [Model discovery](apps/docs/content/docs/(api)/(inference-api)/models-discovery.mdx).

Monorepo — Turborepo on Bun workspaces:

- `apps/gateway` — the service, **runs on Bun**. Package `@boelabs/bifrost`.
- `apps/dashboard` — operator dashboard (Next.js App Router + Base UI with BaseLayer styling),
  **runs on Bun**. Package `@boelabs/dashboard`. Optional at deployment (`DASH_ENABLED`). Its own
  component kit lives at `src/components/ui`. See [its README](apps/dashboard/README.md).

The gateway and the dashboard are **two independent products**, not one deployment: two images, two
domains, two processes. One variable joins them — `GATEWAY_URL` on the dashboard — because the
browser never talks to the gateway: the dashboard's server does, and relays the three calls that
must be the browser's own request (sign-in, sign-out, the playground's stream) through its own
routes. See `apps/dashboard/src/shared/api/relay.ts`.

Keep it that way. Adding a browser-to-gateway call means CORS on the gateway, a cross-site cookie
policy that has to agree with it, and a gateway that must be public — three things this repository
does not currently have.
- `apps/docs` — documentation site (Next.js App Router + [Fumadocs](https://fumadocs.dev), MDX),
  prerendered at build time. Package `@boelabs/docs`. Built and served on Bun.
- `packages/tsconfig` — shared strict TypeScript config (`@boelabs/tsconfig`).
- `docker/` — every Compose file and the stack's `.env.example`, with [its own README](docker/README.md).

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

Dashboard-only: `bun run --filter @boelabs/dashboard <script>` — `dev`, `build`, `start`,
`typecheck`, `test`, `api:types`.

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
- **The rule set comes from [Ultracite](https://www.ultracite.ai)**, a pinned preset for Biome —
  configuration only, no second tool and no extra CLI. [`biome.jsonc`](biome.jsonc) extends
  `ultracite/biome/{core,react,next}` and then states, with a reason on each line, the handful of
  rules this repository turns off and the ones that are still `"info"`. Read those comments before
  changing them: every `off` was measured against the tree, and an `"info"` rule is a backlog with a
  count next to it, not a rule nobody wanted. Driving one to zero and promoting it to `"error"` is a
  welcome pull request; adding a new `off` to make your own change pass is the gate-weakening §1
  forbids. Upgrade the preset in a pull request of its own — a minor bump changes which rules apply.
- **`apps/gateway/openapi.yaml` is generated, never hand-edited.** It comes from the Zod schemas in
  `src/openapi/` via `openapi:generate`, and a unit test fails when the committed file drifts. If
  you touch `src/openapi/components.ts`/`document.ts` — or any Zod schema they re-export —
  regenerate and commit the YAML in the same change.
- **Types are strict** (`packages/tsconfig/base.json`: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, …). Fix the types; do not relax the config.
- **Tests are colocated** as `*.test.ts` and must not hit the network —
  `tests/support/noRealFetch.ts` blocks real `fetch`; stub upstreams with `withStubbedFetch()`.

### Dashboard UI

- Compact toolbar actions and filters use `size="sm"` and `borderRadius="full"`.
  Match adjacent controls; form fields keep the shared control radius.
- Creation selects for providers, models and roles start with a placeholder and require an explicit
  choice. Do not select the first available item. Editing preserves the stored selection; filters
  and optional settings may use meaningful defaults such as "All" or "Never".
- Put required credentials directly in the form flow. Avoid decorative fieldsets and copy about
  encryption, validation or adapter internals. Keep help that changes a decision, such as leaving
  a credential blank to preserve it. Explain permissions next to the role selector, not in a page banner.
- Put optional creation fields under "Advanced options", using the deployment dialog pattern.
  Collapsing must retain values, include them on submit and reveal fields with validation errors.
- Choose charts by the question: areas for activity over time, lines for latency, bars for interval
  volumes or category comparisons, and donuts for mutually exclusive parts of one total. Never
  stack overlapping subsets (cache writes, reasoning) or mix units on one axis. Missing measurements
  stay missing, never zero; show units, UTC intervals, exact values and readable legends.
- Use the shared chart components and distinct chart color tokens in both themes. Neutral surface
  colors are not a chart palette. Support keyboard access, narrow screens and reduced motion.
- Skeletons mirror the current component's count, breakpoints, padding, control heights and shape.
  Update them with layout changes. Audit keeps its server pagination and visible result count,
  including one-page results and empty pages with an offset that can be navigated back from.

## 5. Architecture — keep the layering intact

```
contracts/  → public request/response shapes (OpenAI, Anthropic)
core/       → provider-agnostic canonical hub (the "unified" format)
adapters/   → upstream provider protocols (one dir per provider, each with its catalog.json)
endpoints/  → HTTP handlers (+ endpoints/runtime/ for shared per-request plumbing)
```

Adapters translate **to/from** the canonical format and must **never leak provider-specific fields
into `core`**. The canonical vocabulary is fixed — see the
[glossary](apps/docs/content/docs/(api)/(reference)/glossary.mdx).

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
- **Every migration must also work against the previous release.** A deployment overlaps the two:
  the migration job runs while the old gateway is still serving, and a rolling update keeps both
  versions live for a while. So a rename or a drop is three changes, not one — add the new column
  and write to both, then ship the code that reads it, then drop the old one in a later migration.
  A migration that breaks N−1 is an outage, not a schema change. See
  [Rollouts](apps/docs/content/docs/(docs)/(operate)/rollouts.mdx).
- Historical migrations contain hand-tuned DDL and stay immutable even after a later migration
  removes the structure; snapshots describe the schema at each point in time.
- `pgEnum`s must be **`export const`** or drizzle-kit won't emit their `CREATE TYPE`.
- `src/db/migrations/**` is excluded from Biome (drizzle owns its formatting).

## 7. Adding a provider or model

A new provider touches **four** files: the adapter `index.ts`, its `catalog.json`,
`PROVIDER_REGISTRATIONS` in `src/adapters/index.ts`, and the list in `scripts/validate-catalog.ts`
(forget the last and CI never validates the new catalog). Step by step:
[model catalog → Adding catalog entries](apps/docs/content/docs/(docs)/(providers)/model-catalog.mdx#adding-catalog-entries).

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

### Releases

A release is a `v<semver>` tag. It publishes all three images — gateway, dashboard, docs — at **the
same version**, even when only one of them changed. That is deliberate: the dashboard's API client
is generated from the gateway's `openapi.yaml`, so independent version numbers would create a
compatibility matrix somebody has to maintain, and republishing an unchanged image costs nothing.

Everyday pushes do not produce releases. CI publishes `sha-<commit>` and `<branch>` tags, but only
for `main` and for branches named in `COOLIFY_DEPLOY_MAP` — the registry is public, and a feature
branch has no business leaving a package behind. Every other branch still builds the images, so a
broken Dockerfile fails on the pull request. `latest` and the semver tags belong to
[`release.yml`](.github/workflows/release.yml) alone, because a registry tag that moves with every
commit is not the promise `latest` is supposed to make.

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
files stay out of git except the committed `.env.example` templates.

## 10. Things that will bite you

- **Bun is the runner, not a dependency.** Application code in both apps uses web and Node APIs
  only; `Bun.*` and `bun:*` imports belong in tests and in dev scripts. The gateway and the
  dashboard both happen to run under Bun today, and nothing in either app should make that the only
  option.
- **Neither app may carry configuration into its image.** No build arguments for hostnames, no
  `NEXT_PUBLIC_*`, and nothing read from `process.env` at module scope — a value captured when a
  module is first evaluated can be captured during a Next prerender and baked into the build. Read
  it per request instead (`apps/dashboard/src/shared/config/server.ts`). One image, promoted between
  environments; a hostname change is a restart, not a rebuild.
- **The dashboard's client/server boundary is load-bearing.** `src/shared/api/client.ts` reads the
  visitor's cookies through `next/headers`, so importing it from a `"use client"` module is a build
  error. Each feature is therefore split three ways, and a change that crosses the boundary in the
  wrong direction fails the build rather than misbehaving quietly:

  | File | Runs | May be imported by |
  |---|---|---|
  | `features/<f>/common.ts` | either | anything — types and pure helpers only |
  | `features/<f>/api.ts` | server | Server Components and `actions.ts` |
  | `features/<f>/actions.ts` | server (`"use server"`) | anything, including Client Components |

  Two consequences worth knowing before you hit them. A Server Component **cannot read a runtime
  value out of a `"use client"` module** — it gets a client reference, not the value — which is why
  table headers and tone helpers live in `common.ts`. And a Server Action must **return** its
  failure rather than throw it (`shared/lib/action.ts`), because a production build replaces a
  thrown error's message with a generic one and the gateway's message is the whole point.

- **Nothing session-scoped is cached.** `cacheComponents` is on, so every page renders a static
  shell and streams its data into it. The only `'use cache'` in the app is the public model catalog
  (`features/playground/catalog.ts`), which is unauthenticated. Anything reading `cookies()` — which
  is every gateway call — must sit behind a `<Suspense>` boundary, and anything reading the clock
  before it needs `await connection()` first or `next build` will refuse to prerender the shell.
  Read the URL on the server (each page has a zod schema) and pass the result down as props;
  `useSearchParams()` in a control pulls it out of the shell on every cold load.

- **The dashboard's generated files.** `src/shared/api/schema.d.ts` is generated from
  `apps/gateway/openapi.yaml` (`bun run --filter @boelabs/dashboard api:types`) — regenerate it in
  the same change that alters the admin API. `.next/types` is written by `next typegen`, which the
  dashboard's `typecheck` script runs first; `apps/dashboard/AGENTS.md` is rewritten by `next dev`
  and points at version-matched docs in `node_modules/next/dist/docs`. Read those before reaching
  for a Next API — this is not the Next.js most training data describes.

- **UI components live in `apps/dashboard/src/components/ui`** and use Base UI primitives. They are
  the app's own kit, not a package: import them as `#/components/ui/<component>`. They must not
  import dashboard features.

- **Bun's TLS rejects self-signed Postgres/Redis certificates** (e.g. databases exposed on a raw
  Coolify/Dokploy port). Use a private network without TLS, or a public-CA certificate.
  See [Troubleshooting](apps/docs/content/docs/(docs)/(operate)/troubleshooting.mdx).
- **Background jobs run in-process**, not via cron: operation retention/reconciliation,
  `response_states` GC, extension reloads, and video polling/asset GC.
- **Integration tests** (`tests/integration/*.integration.test.ts`) need a real Postgres + Redis and
  run **one process per file** via `scripts/run-integration.ts` — they assume per-file isolation, and
  a shared `bun test` process leaks connections between files. They skip cleanly without the infra.
- **CI's lint gate is exactly `bun run check` from the repo root** — whole repo, same flags. A
  path-scoped `biome check <paths>` on the files you edited misses the ones your change regenerated
  or serialized, and those are what fail in CI.
