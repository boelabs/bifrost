# syntax=docker/dockerfile:1
#
# Monorepo image for the Bifrost operator dashboard (Next.js App Router + Base UI).
# The BUILD CONTEXT is the repo ROOT (it needs the workspace manifests and lockfile), so build from
# the root with:
#
#   docker build -f apps/dashboard/Dockerfile -t bifrost-dashboard .
#
# Everything here runs on BUN, including the server: `oven/bun` ships no `node` binary, so Next's
# standalone output is started with `bun server.js`.
#
# The image carries NO configuration. There is no build argument for the gateway's address and no
# NEXT_PUBLIC_* anywhere in the app, so one build can be promoted through staging and production
# unchanged; the addresses are read from the environment when the server starts and when a request
# arrives. See apps/dashboard/src/shared/config/server.ts.
#
# Required at RUN time:
#   GATEWAY_URL   where the gateway is, e.g. http://gateway:4000. Only this container needs
#                 to reach it; the browser never leaves this app's own origin.

# ---- deps: full install (the build needs devDependencies) ----
FROM oven/bun:1.4.0 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY patches ./patches
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/docs/package.json ./apps/docs/package.json
COPY apps/gateway/package.json ./apps/gateway/package.json
COPY packages/tsconfig/package.json ./packages/tsconfig/package.json
RUN bun install --frozen-lockfile --filter @boelabs/dashboard

# ---- build: next build under Bun; emits .next/standalone ----
FROM oven/bun:1.4.0 AS build
WORKDIR /app
ENV NODE_ENV=production
COPY package.json bun.lock ./
COPY packages ./packages
COPY apps/dashboard ./apps/dashboard
# The gateway's OpenAPI document is the source of the dashboard's API types. It is copied (not
# regenerated) so the image cannot drift from the spec committed alongside it.
COPY apps/gateway/openapi.yaml ./apps/gateway/openapi.yaml
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/dashboard/node_modules ./apps/dashboard/node_modules
RUN cd apps/dashboard && bun run build

# ---- runtime: Bun serving Next's standalone output ----
# There is no separate production-dependency install: `output: "standalone"` traces exactly the
# modules the server actually imports and writes them into the bundle, which is also why nothing
# here can resolve a package from npm at boot.
FROM oven/bun:1.4.0 AS runtime
WORKDIR /app/apps/dashboard
ENV NODE_ENV=production \
    PORT=3001 \
    HOSTNAME=0.0.0.0

# The workspace layout is preserved: the traced node_modules land at /app, the server at
# /app/apps/dashboard, exactly as `next build` arranged them.
COPY --chown=bun:bun --from=build /app/apps/dashboard/.next/standalone /app/
# Neither of these is part of the traced bundle — the hashed client chunks and everything under
# public/ are static files the server expects to find beside it.
COPY --chown=bun:bun --from=build /app/apps/dashboard/.next/static ./.next/static
COPY --chown=bun:bun --from=build /app/apps/dashboard/public ./public

USER bun
EXPOSE 3001

# /api/config rather than a page: it answers iff the server is up AND knows where the gateway is,
# and it does not itself call the gateway — a gateway outage is the gateway's health to report, not
# a reason to restart the dashboard.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "server.js"]
