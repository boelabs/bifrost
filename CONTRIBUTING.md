# Contributing to Bifrost

Thanks for your interest in contributing! This document describes how to set up the project, the
conventions we follow, and what we expect in a pull request.

## Code of Conduct

By participating in this project you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Repository layout

This is a [Turborepo](https://turborepo.com) on [Bun](https://bun.sh) workspaces:

- `apps/gateway` — the Bifrost service (runs on Bun).
- `apps/docs` — the documentation site (Next.js, Fumadocs, MDX).
- `packages/tsconfig` — shared TypeScript configuration.

Dependencies, tasks, and the gateway runtime are all Bun (with Turbo orchestrating the workspace). Bun
runs TypeScript directly, so there is no build step. Note: Bun's TLS may not accept self-signed
Postgres/Redis certificates — see the docs' Known errors page.

## Requirements

- Bun 1.3+ (gateway runtime, package manager, and task runner — runs TypeScript directly, no build step)
- Postgres 18+
- Redis 8+
- Docker (optional, for spinning up Postgres/Redis locally)

## Local setup

```bash
bun install
docker compose -f docker-compose.yml -f compose.local.yaml up -d postgres redis
cp apps/gateway/.env.example apps/gateway/.env    # then fill in the master key and encryption keyring
bun run --filter @boelabs/bifrost db:migrate
bun run --filter @boelabs/bifrost dev
```

Generate a 32-byte hex value for each `ENCRYPTION_KEYRING` entry with:

```bash
openssl rand -hex 32
```

## Before opening a pull request

Run the full local gate from the repo root. CI runs the same checks and will block the PR if any fail.

```bash
bun run check        # Biome format + lint (whole repo)
bun run typecheck    # turbo: tsc + Fumadocs/Next typegen
bun run test         # turbo: unit tests across packages
```

If your change touches database access, the router, rate limiting, or admin endpoints, also run the
integration suite (needs Postgres + Redis running):

```bash
bun run --filter @boelabs/bifrost test:integration
```

## Conventions

- **Language:** all code, comments, identifiers, commit messages, and documentation are written in
  **English**.
- **Formatting & linting:** [Biome](https://biomejs.dev) is the single source of truth. Tabs for
  indentation, double quotes. Run `bun run check:fix` to auto-fix.
- **Types:** the shared config in `packages/tsconfig/base.json` is strict (`noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, etc.). Do not weaken it; prefer fixing the types.
- **Architecture:** keep the layering intact. Public request/response shapes live in
  `apps/gateway/src/contracts`, the provider-agnostic hub in `apps/gateway/src/core`, upstream
  protocols in `apps/gateway/src/adapters`, and HTTP handlers in `apps/gateway/src/endpoints`.
  Adapters translate to/from the canonical format — they never leak provider-specific fields into
  `core`. See the [glossary](apps/docs/content/docs/glossary.mdx) for the canonical vocabulary.
- **Tests:** colocate unit tests next to the code as `*.test.ts`. Unit tests must not hit the network
  (`apps/gateway/tests/support/noRealFetch.ts` enforces this). Integration tests live under
  `apps/gateway/tests/integration`.
- **Database migrations:** the schema is `apps/gateway/src/db/schema.ts`. Run `bun run db:generate`
  (drizzle-kit) to emit a migration after changing it, then `bun run db:migrate` to apply (Drizzle's
	  migrator). Migrations are forward-only — never edit an already-applied migration. Historical
	  hand-tuned DDL remains immutable even after later migrations remove those structures.

## Adding a provider adapter

Each adapter is a self-contained folder under `apps/gateway/src/adapters/<provider>/`. Adding one
touches **four** files:

1. `src/adapters/<provider>/index.ts` — the adapter (often a few lines via `makeOpenAIStyleAdapter(...)`),
   exporting the adapter and a `ProviderModule`.
2. `src/adapters/<provider>/catalog.json` — the provider's model catalog.
3. `src/adapters/index.ts` — import the provider and add it to `PROVIDER_REGISTRATIONS` with its
   `catalogUrl`.
4. `scripts/validate-catalog.ts` — add the catalog to the validated list, **or CI won't check it**.

The catalog shape and a full step-by-step (including adding just a model to an existing provider) are
in the [model catalog guide](apps/docs/content/docs/model-catalog.mdx#adding-catalog-entries). Use
`POST /admin/deployments/resolve` to verify the effective capabilities and transports before wiring
tests. See the [deployments guide](apps/docs/content/docs/creating-deployments.mdx).

## Commit messages

Use clear, imperative-mood messages (e.g. `add deepseek adapter`, `fix cooldown reset on success`).
Conventional Commit prefixes are welcome but not required.

## Reporting bugs and requesting features

Use the GitHub issue templates. For security issues, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.
