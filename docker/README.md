# Docker

Every Compose file, and the environment template that goes with them. Run them from this directory —
`compose.yaml` is what `docker compose` picks up with no arguments — or point `-f` at them from
anywhere.

| File | What it runs | For |
|---|---|---|
| `compose.yaml` | Postgres, Redis, migrations, gateway, dashboard — **built from this checkout** | contributors |
| `compose.images.yaml` | the same stack, from published images | operators who want one stack |
| `compose.local.yaml` | overlay: binds host ports on loopback | local development |
| `compose.data.yaml` | Postgres and Redis alone | the split topology, below |
| `compose.docs.yaml` | the documentation site alone | anyone who wants it published |

The docs site is deliberately on its own: it has no database, no cache, no network and no variables
in common with the gateway, so putting it in the stack only meant remembering to delete it.

## Run it

```bash
cp .env.example .env    # then fill in the blanks it lists
docker compose -f compose.images.yaml up -d
```

From a checkout, with host ports bound on loopback:

```bash
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

## One stack, or one resource per app

`compose.images.yaml` deploys as a unit, which is simple and means a deployment briefly has nothing
listening. For rolling updates, run each app as its own resource on your platform and keep only the
stateful half here:

```bash
docker compose -f compose.data.yaml up -d
```

The gateway, dashboard and docs then run from `ghcr.io/<owner>/bifrost-{gateway,dashboard,docs}` and
reach Postgres and Redis over the shared network. What that buys, what it costs, and the settings it
needs are in [Rollouts](../apps/docs/content/docs/(docs)/(operate)/rollouts.mdx).

## Two things worth knowing

**`stop_grace_period` is load-bearing.** The gateway drains on `SIGTERM` — it stays unready but
serving while your proxy deregisters it, then lets in-flight requests finish. Docker's default
deadline is 10 seconds, which is shorter than that, so the process would be killed mid-drain. The
gateway is set to `180s` here; raise `DRAIN_DELAY_MS` and `SHUTDOWN_TIMEOUT_MS` and this together.

**`NODE_ENV`, `PORT` and `HOSTNAME` are not set here.** All three images already define them. These
files carry only what you have to decide.
