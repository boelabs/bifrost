# syntax=docker/dockerfile:1
#
# Monorepo image for the Bifrost documentation (Next.js App Router + Fumadocs).
# The BUILD CONTEXT is the repo ROOT (it needs the workspace manifests and lockfile), so build from
# the root with:
#
#   docker build -f apps/docs/Dockerfile -t bifrost-docs .
#
# Everything runs on BUN, including the server: `oven/bun` ships no `node` binary, so Next's
# standalone output is started with `bun server.js`.
#
# The site carries no configuration. Every page is prerendered from MDX in this repository, so the
# image is the same everywhere and nothing needs to be passed at run time.

# ---- deps: full install (the build needs devDependencies) ----
FROM oven/bun:1.4.0 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY patches ./patches
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/gateway/package.json ./apps/gateway/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json
# Scripts are skipped here on purpose. @boelabs/docs has a postinstall that runs `fumadocs-mdx` to
# generate the `.source` collection, and this stage holds manifests only: with no `next.config.ts`
# beside it the generator picks its Vite entry over its Next one and fails on a missing peer, and
# with no `source.config.ts` or `content/` it would have nothing to read anyway. It runs in the
# build stage instead, where the source tree actually exists.
RUN bun install --frozen-lockfile --filter @boelabs/docs --ignore-scripts

# ---- build: next build under Bun; emits .next/standalone ----
FROM oven/bun:1.4.0 AS build
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
COPY package.json bun.lock ./
COPY apps/docs ./apps/docs
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/docs/node_modules ./apps/docs/node_modules
# `.source` first (see the deps stage), then the build that imports it.
RUN cd apps/docs && bun run postinstall && bun run build

# ---- runtime: Bun serving Next's standalone output ----
# No separate production install: `output: "standalone"` traces exactly the modules the server
# imports and writes them into the bundle, which is also why nothing here resolves from npm at boot.
FROM oven/bun:1.4.0 AS runtime
WORKDIR /app/apps/docs
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The workspace layout is preserved: traced node_modules at /app, the server at /app/apps/docs,
# exactly as `next build` arranged them.
COPY --chown=bun:bun --from=build /app/apps/docs/.next/standalone /app/
# Neither of these is traced — the hashed client chunks and everything in public/ are static files
# the server expects to find beside it.
COPY --chown=bun:bun --from=build /app/apps/docs/.next/static ./.next/static
COPY --chown=bun:bun --from=build /app/apps/docs/public ./public

# curl, for the platform's health check rather than ours.
#
# The HEALTHCHECK below needs no tools — it runs `bun`, which is obviously present. But a PaaS that
# defines its own check (Coolify, Dokploy) executes `curl` or `wget` INSIDE this container and fails
# with "curl: not found" on an image that has neither, which reads as an unhealthy app and rolls the
# deployment back. Debian's bun image ships no HTTP client at all, so one is installed here.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

USER bun
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "server.js"]
