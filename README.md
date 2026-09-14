<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="brand/bifrost-mark-dark.png">
  <img src="brand/bifrost-mark-light.png" alt="" width="132">
</picture>

# Bifrost

**One contract. Every model provider.**

A backend-only, provider-agnostic AI gateway — built and operated by [Boelabs](https://boelabs.com).

[Documentation](apps/docs/content/docs/(docs)/index.mdx) ·
[Quickstart](apps/docs/content/docs/(docs)/(get-started)/quickstart.mdx) ·
[Architecture](apps/docs/content/docs/(docs)/(get-started)/architecture.mdx) ·
[OpenAPI](apps/gateway/openapi.yaml)

</div>

---

Bifrost gives a product team a single, stable, OpenAI-shaped API in front of every model vendor it
uses. Applications keep one integration; the gateway owns authentication, routing, rate limiting,
budgets, caching, cost accounting, and observability. Swapping providers, adding a model, or failing
over becomes a configuration change instead of a release.

We built it as the inference layer behind our own products, and we run it in production. It is
shared infrastructure, not a demo.

## Why teams run a gateway

| Without | With Bifrost |
|---|---|
| One SDK and auth scheme per vendor | One OpenAI-compatible contract for all of them |
| Vendor outages reach your users | Weighted pools, cooldowns, retries, dedicated fallbacks |
| Keys embedded in every service | Virtual keys with scopes, RPM/TPM limits, and budgets |
| Spend and latency invisible until the invoice | Per-request cost accounting, logs, and OpenTelemetry |
| Provider migrations are code changes | Provider migrations are catalog and deployment changes |

## Capabilities

- **Public contracts** — exact OpenAI shapes for Chat Completions, Responses, Images, Embeddings,
  Audio Transcriptions, Videos, Reranking, and Models; plus an Anthropic-compatible `/v1/messages`
  rendered from the same canonical core.
- **Providers** — OpenAI, Anthropic, Google AI Studio, Azure OpenAI, Azure Foundry, Vercel AI
  Gateway, OpenRouter, DeepSeek, MiniMax, Moonshot, ZAI, and any OpenAI-compatible endpoint.
- **Routing** — public model aliases over weighted deployment pools, with cooldowns, retries,
  per-operation transports, and explicit fallback chains.
- **Access control** — a master key for operations, virtual keys for clients, with model scopes,
  rate limits, budgets, and standard rate-limit headers.
- **Operations** — opt-in response cache, durable operation logs with retained payload samples,
  cost accounting, OpenTelemetry metrics and traces, and graceful shutdown.
- **Extensibility** — runtime extensions stored in Postgres and managed over the Admin API add
  request/response/stream/image hooks without forking the gateway.
- **Operator dashboard** — optional (`DASH_ENABLED`), an independent deployment on its own domain: models and
  deployments, virtual keys, logs and usage, router settings, an audit trail of every configuration
  change, and a playground that switches public contract and model.

Pre-1.0: contracts are covered by unit and integration tests, but breaking changes are still
possible while the adapter surface and Admin API settle.

## Architecture

Every request is translated into one canonical representation, routed to a deployment, and executed
against a provider adapter. Adapters never leak provider-specific fields into the core.

```
contracts/   public request/response shapes (OpenAI, Anthropic)
core/        provider-agnostic canonical hub
router/      deployment selection: strategy, cooldowns, fallbacks
adapters/    upstream provider protocols (one directory per provider)
endpoints/   HTTP handlers and shared per-request plumbing
```

Details, in order of execution: [Architecture](apps/docs/content/docs/(docs)/(get-started)/architecture.mdx).

## Repository

A [Turborepo](https://turborepo.com) on [Bun](https://bun.sh) workspaces. Bun runs TypeScript
directly, so there is no build step.

```
apps/gateway      the Bifrost service (@boelabs/bifrost)
apps/dashboard    optional operator dashboard (@boelabs/dashboard, Next.js App Router)
apps/docs         documentation site (@boelabs/docs, Next.js App Router + Fumadocs)
packages/tsconfig shared strict TypeScript config (@boelabs/tsconfig)
```

## Quickstart

Requirements: Bun 1.4+, Postgres 18+, Redis 8+ (Docker optional, for local dependencies).

```bash
bun install
docker compose -f docker-compose.yml -f compose.local.yaml up -d postgres redis
cp apps/gateway/.env.example apps/gateway/.env
bun run --filter @boelabs/bifrost db:migrate
bun run --filter @boelabs/bifrost dev
```

Set `MASTER_KEY`, `ENCRYPTION_KEYRING`, and `ACTIVE_ENCRYPTION_KEY_ID` in `.env` — the gateway
refuses to start without them. Generate each keyring value with `openssl rand -hex 32`. Everything
else ships with production-ready defaults ([environment reference](apps/docs/content/docs/(api)/(reference)/reference-environment.mdx)).

```bash
curl http://localhost:4000/health/live     # liveness (no dependencies)
curl http://localhost:4000/health/ready    # readiness (Postgres, Redis, extensions)
```

From here, the [Quickstart guide](apps/docs/content/docs/(docs)/(get-started)/quickstart.mdx) goes from clone to a first
completion: create a deployment through the Admin API, then call `/v1/chat/completions`.

### Workspace commands

```bash
bun run dev          # all dev tasks (gateway, dashboard, docs)
bun run check        # Biome format + lint, whole repo — the CI gate
bun run typecheck    # typecheck every package
bun run test         # unit tests across packages
```

Scope to one package with `--filter`, e.g. `bun run --filter @boelabs/bifrost dev`.

## Production

Published images, no checkout required — `compose.images.yaml` pulls them and is complete on its
own, so it can be pasted straight into Coolify, Dokploy or Portainer:

```bash
curl -O https://raw.githubusercontent.com/boelabs/bifrost/main/compose.images.yaml
curl -o .env https://raw.githubusercontent.com/boelabs/bifrost/main/.env.example  # then fill it in
docker compose -f compose.images.yaml up -d
```

| Image | |
|---|---|
| `ghcr.io/boelabs/bifrost-gateway` | the API |
| `ghcr.io/boelabs/bifrost-dashboard` | the operator UI, on its own domain |
| `ghcr.io/boelabs/bifrost-docs` | this documentation |

The gateway and the dashboard are two independent products with one setting between them:
`GATEWAY_URL` on the dashboard. The browser never leaves the dashboard's own origin — its server
fetches everything — so there is no CORS anywhere and the gateway need not be public at all.
Neither image contains configuration, so one tag is promoted between environments rather than
rebuilt. See
[Operator dashboard → Serving it](apps/docs/content/docs/(docs)/(operate)/dashboard.mdx).

To build from a checkout instead, `docker-compose.yml` is the production/PaaS base — Postgres,
Redis, a one-off migration job, the gateway, the dashboard and the docs site, without publishing
host ports. Merge `compose.local.yaml` for a local single-host run with loopback ports and
development-only secrets.

```bash
MASTER_KEY=$(openssl rand -base64 48) \
ENCRYPTION_KEY_HEX=$(openssl rand -hex 32) \
docker compose -f docker-compose.yml -f compose.local.yaml up -d
```

Platform guides and the production runbook:
[Deployment](apps/docs/content/docs/(docs)/(deploy)/deployment.mdx) ·
[Operations](apps/docs/content/docs/(docs)/(operate)/operations.mdx) ·
[Production checklist](apps/docs/content/docs/(docs)/(operate)/production-checklist.mdx).

## Documentation

Everything beyond this page is authored in MDX under
[`apps/docs/content/docs`](apps/docs/content/docs) and rendered by a Next.js + Fumadocs site
(`bun run --filter @boelabs/docs dev`). Start at the
[Overview](apps/docs/content/docs/(docs)/index.mdx), which maps the full set: API contracts, provider
setup, routing, virtual keys, extensions, security, and troubleshooting. The machine-readable spec
is [`apps/gateway/openapi.yaml`](apps/gateway/openapi.yaml). Development, builds, and the production
file server all run on Bun. See [Documentation development](apps/docs/content/docs/(docs)/(extend)/documentation.mdx)
for preview commands, page conventions, and deployment.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and the checks CI runs. AI coding
agents start with [AGENTS.md](AGENTS.md). All code, comments, and documentation are in English.

Report vulnerabilities through [SECURITY.md](SECURITY.md) — never in a public issue.

## License

[MIT](LICENSE) · © Boelabs
