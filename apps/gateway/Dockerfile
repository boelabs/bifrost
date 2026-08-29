# syntax=docker/dockerfile:1
#
# Monorepo image for the Bifrost service. The BUILD CONTEXT is the repo ROOT (it needs the
# workspace manifests and lockfile), so build from the root with:
#
#   docker build -f apps/gateway/Dockerfile -t bifrost .
#
# Both the dependency install and the service runtime are Bun (fast, deterministic). Bun runs
# TypeScript directly, so there is no compile step. NOTE: Bun's TLS client can fail against self-signed
# Postgres/Redis certificates (e.g. Coolify): connect to those over a private network without TLS, or
# via a managed provider with a public-CA certificate. See the docs "Known errors" section.

# ---- deps: production dependencies only, with Bun ----
FROM oven/bun:1.4.0 AS deps
WORKDIR /app
ENV NODE_ENV=production
# Copy only the manifests + lockfile first so this layer caches until dependencies change.
COPY package.json bun.lock ./
COPY apps/gateway/package.json ./apps/gateway/package.json
COPY apps/docs/package.json ./apps/docs/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json
RUN bun install --frozen-lockfile --production --filter @boelabs/bifrost

# ---- runtime: Bun ----
FROM oven/bun:1.4.0 AS runtime
WORKDIR /app/apps/gateway
ENV NODE_ENV=production \
    PORT=4000

# Workspace node_modules (Bun's isolated install places deps in the app dir; the root holds shared
# tooling links) plus the linked shared packages.
COPY --chown=bun:bun --from=deps /app/node_modules /app/node_modules
COPY --chown=bun:bun --from=deps /app/apps/gateway/node_modules ./node_modules
COPY --chown=bun:bun --from=deps /app/packages /app/packages

# Application source (run directly via Node's native type stripping; no build artifacts).
COPY --chown=bun:bun apps/gateway/package.json ./package.json
COPY --chown=bun:bun apps/gateway/src ./src

# The runtime materializes extension modules into ./.extensions-cache (kept inside the package so the
# modules' `#extensions/sdk.ts` import resolves). WORKDIR is created as root, so the non-root `bun`
# user cannot write there by default — give it ownership of the workdir and pre-create the cache dir.
RUN mkdir -p ./.extensions-cache && chown bun:bun . ./.extensions-cache

USER bun
EXPOSE 4000

# Container-level healthcheck hits LIVENESS, not readiness: a Docker healthcheck failure can trigger
# a restart, and restarting will not bring Postgres/Redis back — so it must not depend on them.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are intentionally NOT run here; run `bun src/db/migrate.ts` inside this image as a
# one-off before rollout.
CMD ["bun", "src/index.ts"]
