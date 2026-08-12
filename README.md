# Bifrost

Bifrost is a backend-only, provider-agnostic AI gateway. It exposes stable OpenAI-shaped public
endpoints while routing requests to provider-specific upstream APIs through adapters.

Bifrost is developed by Boelabs as shared infrastructure for the products and services we run or
plan to run.

It is built for teams that want one public model catalog, one auth/rate-limit/logging layer, and one
predictable contract across OpenAI, Anthropic, Google, Azure, OpenAI-compatible providers, and custom
models.

## Highlights

- Exact OpenAI-compatible public contracts for Chat Completions, Responses, Images, Embeddings, Audio Transcriptions, and Models.
- Anthropic-compatible `/v1/messages` rendering over the same canonical core.
- Provider adapters for OpenAI, OpenAI-compatible APIs, Google AI Studio, Anthropic, Azure OpenAI, Azure Foundry, Vercel AI Gateway, DeepSeek, MiniMax, Moonshot, and ZAI.
- Public model aliases, weighted pools, cooldowns, retries, dedicated fallbacks, and per-operation transports.
- Master key plus virtual keys with model scopes, RPM/TPM limits, budgets, and rate-limit headers.
- Opt-in response cache, durable operation logs, cost accounting, OpenTelemetry metrics/traces, and graceful shutdown.
- Admin API and OpenAPI spec for operating deployments, keys, router settings, logs, usage, and fallbacks.
- Runtime extensions stored in Postgres and managed through the Admin API for request/response/stream/image hooks without forking the gateway.

## Status

Bifrost is pre-1.0. The main contracts are covered by unit and integration tests, but breaking
changes are still possible while the adapter surface and admin API settle.

## Monorepo layout

This repository is a [Turborepo](https://turborepo.com) managed with [Bun](https://bun.sh) workspaces.

```
.
├── apps/
│   ├── gateway/        # the Bifrost service (runs on Bun; see apps/gateway)
│   └── docs/           # documentation site (Next.js, Fumadocs, MDX)
├── packages/
│   └── tsconfig/       # shared TypeScript configuration (@boelabs/tsconfig)
├── turbo.json          # task pipeline
└── package.json        # workspace root (bun workspaces + turbo)
```

Dependencies, tasks, and the gateway runtime are all **Bun** (with Turbo orchestrating the workspace);
Bun runs TypeScript directly, so there is no build step.

## Quickstart

Requirements: Bun 1.3+, Postgres 18+, Redis 8+ (Docker optional, for local dependencies).

```bash
bun install
docker compose -f docker-compose.yml -f compose.local.yaml up -d postgres redis
cp apps/gateway/.env.example apps/gateway/.env
bun run --filter @boelabs/bifrost db:migrate
bun run --filter @boelabs/bifrost dev
```

In `.env`, set `MASTER_KEY`, `ENCRYPTION_KEYRING`, and `ACTIVE_ENCRYPTION_KEY_ID`. Generate each
keyring value with `openssl rand -hex 32`. Everything else ships with production-ready defaults — the full environment
reference lives in [Setup](apps/docs/content/docs/setup.mdx).

```bash
curl http://localhost:4000/health/live    # liveness (no dependencies)
curl http://localhost:4000/health/ready   # readiness (Postgres + Redis + extensions)
```

From here, the [Quickstart guide](apps/docs/content/docs/quickstart.mdx) walks from clone to a first
completion: create a deployment through the Admin API, then call `/v1/chat/completions` with your key.

Common workspace commands, from the repo root:

```bash
bun run dev          # run all dev tasks via turbo (gateway + docs)
bun run typecheck    # typecheck every package
bun run test         # unit tests across packages
bun run check        # Biome format + lint (whole repo)
```

To work on a single package, use `--filter`, e.g. `bun run --filter @boelabs/bifrost dev`.

## Running in production

Both apps ship container images built from the repo root (`apps/gateway/Dockerfile`,
`apps/docs/Dockerfile`). `docker-compose.yml` is the production/PaaS base: Postgres, Redis, a one-off
migration job, the gateway, and the docs site, without publishing host ports — Coolify, Dokploy, and
similar platforms deploy that file directly and expose services through their proxy. For local or
single-host use, merge `compose.local.yaml`, which publishes ports on loopback and provides
development-only secrets:

```bash
MASTER_KEY=$(openssl rand -base64 48) \
ENCRYPTION_KEY_HEX=$(openssl rand -hex 32) \
docker compose -f docker-compose.yml -f compose.local.yaml up -d
```

The production base leaves both secrets empty and the gateway refuses to start until they are
configured. Per-platform guides and the compose naming rationale:
[Deployment](apps/docs/content/docs/deployment.mdx).

## Documentation

Everything beyond this page — API contracts, provider setup, admin operations — lives in the docs,
authored in MDX under [`apps/docs/content/docs`](apps/docs/content/docs) and rendered as a Fumadocs
site (`bun run --filter @boelabs/docs dev`).

- [Overview](apps/docs/content/docs/index.mdx) — what Bifrost is, and the full documentation map
- [Quickstart](apps/docs/content/docs/quickstart.mdx) — clone to first response, end to end
- [Architecture](apps/docs/content/docs/architecture.mdx) — the request pipeline, traced in precise order
- [Setup](apps/docs/content/docs/setup.mdx) — requirements, environment, secrets, and database choices
- [Deployment](apps/docs/content/docs/deployment.mdx) — Docker Compose and per-platform guides (Coolify, Portainer, Dokploy, Linux)
- [Creating deployments](apps/docs/content/docs/creating-deployments.mdx) — provider setup and custom model examples
- [Routing](apps/docs/content/docs/routing.mdx) — balancing strategies, cooldowns, and retries
- [Virtual keys](apps/docs/content/docs/virtual-keys.mdx) — client keys, scopes, budgets, and limits
- [Fallbacks](apps/docs/content/docs/fallbacks.mdx) — fallback semantics and lifecycle
- [Model catalog](apps/docs/content/docs/model-catalog.mdx) — catalog schema and capability profiles
- [Providers](apps/docs/content/docs/providers.mdx) — every built-in adapter's credentials and quirks
- [Runtime extensions](apps/docs/content/docs/extensions.mdx) — uploading extensions, hooks, and versioning
- [Operations](apps/docs/content/docs/operations.mdx) — production runbook
- [Security](apps/docs/content/docs/security.mdx) — auth model, credential encryption, and redaction
- [API overview](apps/docs/content/docs/api-overview.mdx) — auth, error shape, and OpenAPI import notes
- [Troubleshooting](apps/docs/content/docs/troubleshooting.mdx) — error shapes, status codes, and known issues with exact fixes

The machine-readable API spec is [`apps/gateway/openapi.yaml`](apps/gateway/openapi.yaml) — see
[the API guide](apps/docs/content/docs/api-overview.mdx) for import instructions.

## Common errors

- **Bun's TLS rejects self-signed Postgres/Redis certificates** (e.g. databases exposed by a raw
  Coolify/Dokploy port). Connect over a private network without TLS, or use a managed provider with a
  public-CA certificate.
- **The gateway refuses to start** until `MASTER_KEY`, `ENCRYPTION_KEYRING`, and
  `ACTIVE_ENCRYPTION_KEY_ID` are set — the
  production compose base deliberately ships them empty.

Exact symptoms, fixes, and every error code: [Troubleshooting](apps/docs/content/docs/troubleshooting.mdx).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup,
conventions, and the checks CI runs. All code, comments, and documentation are written in English.
AI coding agents should start with [AGENTS.md](AGENTS.md).

## Security

To report a vulnerability, follow [SECURITY.md](SECURITY.md). Please do not open public issues for
security problems.

## License

Released under the [MIT License](LICENSE).
