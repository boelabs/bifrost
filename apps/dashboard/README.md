# Bifrost dashboard

The operator dashboard. A **separate product** from the gateway — its own image, its own domain, its
own process — in the same repository. Next.js App Router, Base UI, React 19, Tailwind CSS 4 — all of
it on Bun, including the production server.

Deployment forms show model selection and required credentials first. Advanced options contain
optional credentials, routing limits and overrides, and retain their values when collapsed.
Custom models are inferred from the selected adapter's catalog, including dated model aliases;
OpenAI-compatible has no catalog and always uses an upstream ID input. Their guided editor exposes
operations, capabilities, limits and adapter-supported transports. Technical configuration retains
the full catalog-entry format for specialized profiles, reasoning protocols and parameter mappings.
Catalog models do not expose transport editing; existing overrides are shown read-only and retained
unless the model changes. Pricing uses USD-cent fields and optional input-token tiers, not JSON;
clearing the override restores catalog pricing. Creating or editing validates the complete
configuration before saving; validation failures leave the form open without writing the deployment.

## Why it is shaped like this

**Nothing is baked into the image.** There is no `basePath`, no `NEXT_PUBLIC_*`, and nothing read at
module scope: every address comes from the environment when the server boots or when a request
arrives (`shared/config/server.ts`). One built image is promoted from staging to production; a
hostname change is a restart, not a rebuild.

**One address**, `GATEWAY_URL`, because this process is the only thing that talks to the gateway.

Pages read through Server Components and write through Server Actions, both of which call the
gateway from here. Three things have to be the browser's own request — signing in and out, where
the gateway's `Set-Cookie` must land on the browser, and the playground, which streams inference —
and those go to routes on this app that relay to the gateway (`shared/api/relay.ts`).

So the browser never leaves this origin. No CORS, no cross-site cookie policy, and the gateway does
not have to be reachable from the internet.

**No hand-written API contract.** `src/shared/api/schema.d.ts` is generated from
`apps/gateway/openapi.yaml`, which is itself generated from the gateway's Zod schemas and guarded
against drift by a test. Regenerate after changing the gateway's API:

```bash
bun run --filter @boelabs/dashboard api:types
```

**The session is the credential.** Login sets an httpOnly cookie the page never reads, plus a readable
CSRF token echoed in `X-CSRF-Token` on every mutation — required by the gateway on `/admin` and `/v1`
alike, because inference costs money. No API key is ever held in the browser. Server-side calls relay
both out of `next/headers`, in one place (`shared/api/client.ts`), so a feature cannot forget.

## Layout

Feature-based. **`features/*` never import from each other**; anything two features need lives in
`shared/`, and `app/` is the only layer that composes across features.

```
src/
  app/            the router; composition only
    layout.tsx      <html>, fonts, theme, providers
    auth/           the login screen
    (dash)/         everything behind a session, under one shell
  components/ui/  the Base UI component kit and its theme
  features/       auth · shell · keys · deployments · observability · audit · users · settings · playground
  shared/
    api/          typed client (client.ts) + generated types (schema.d.ts)
    config/       where the gateway is: server.ts (this process) and browser.ts (the page)
    components/   pickers, paging, search, skeletons and the route boundary
    feedback/     toasts and the confirmation dialog, provided once at the root
    lib/
  proxy.ts        the network boundary: no session cookie, no render
```

Each feature is split by where its code runs, which is not a style choice — `api.ts` reads cookies
through `next/headers`, so importing it from a Client Component is a build error:

| File | Runs | Imported by |
|---|---|---|
| `common.ts` | either | anything — types and pure helpers only |
| `api.ts` | server | Server Components and `actions.ts` |
| `actions.ts` | server (`"use server"`) | anything, including Client Components |

Authentication is decided twice, cheaply and then properly. `src/proxy.ts` turns away anyone without
a session cookie before a single component renders; `app/(dash)/layout.tsx` then resolves the actual
identity and sends them back if the gateway rejects it. The layout starts that request but never
awaits it — the promise travels down through context, so the shell stays static and only the parts
that need an operator wait for one.

## How pages behave

**Nothing destructive happens on one click.** Deleting a key, a deployment, an operator, an extension
module or a fallback chain goes through one confirmation dialog provided at the root
(`shared/feedback/confirm.tsx`), and the question names what is actually lost — the last enabled
deployment of a model, the instances still running a module. Every mutation then reports its outcome
as a toast, because a table that silently refreshes cannot be told apart from one that failed to.

**Navigations are instant.** Cache Components and Partial Prefetching are on, so each route has an
App Shell — its title, description, filter controls and table headers — prefetched once and painted
the moment a link is clicked. Only the data sits behind a `<Suspense>` boundary, and the skeleton it
streams into is built from the real component's own classes and the real column headers, so nothing
moves when the rows arrive. `next build` fails a route that stops being true.

**Rows change before the gateway answers.** `shared/lib/mutation.ts` applies an optimistic patch
(or hides the row), runs the Server Action, and lets the revalidated render take over — or puts the
row back and says why. The server's data stays the source of truth; nothing hand-patches a cache.

**Nothing session-scoped is cached.** Every read is scoped to the operator asking, so the only
`'use cache'` in the app is the gateway's public model catalog, which is unauthenticated and answers
the same for everyone.

**Lists are windows, not the whole table.** Keys, users, logs and the audit trail page server-side
with the offset in the URL, and their search and filters are query parameters the gateway applies —
filtering the rows already on screen would search the wrong set.

**Every page owns its failure.** Each route wraps its data in `shared/components/RouteBoundary.tsx`,
so one failing admin call cannot take the shell down and strand the operator without navigation. It
is built on `catchError`, which leaves `redirect()` alone — an expired session still reaches the
login screen instead of being rendered as a failure — and whose `retry()` re-runs the Server
Components rather than merely resetting client state. `app/(dash)/error.tsx` catches the one failure
a page cannot: an unreachable gateway, which the shell itself depends on.

Server Actions **return** their failures rather than throwing them (`shared/lib/action.ts`): a
production build replaces a thrown error's message with a generic one, and the gateway's message —
"budget exhausted", "a deployment with that name already exists" — is the whole point.

**Creates are idempotent.** Key, user and deployment creation send an `Idempotency-Key` held for the
life of the attempt (`shared/lib/useIdempotencyKey.ts`), so a double-click or a retry after a timeout
cannot produce two of anything. The key rotates only once something was created.

## UI

The visual language comes from [BaseLayer](https://baselayer.dev); behavior comes from
[@base-ui/react](https://base-ui.com/react/overview/quick-start), not React Aria or Radix.
Components and theme live in `src/components/ui`. Import them as `#/components/ui/button`,
`#/components/ui/input`, and so on; `app/globals.css` imports Tailwind first and the kit's
stylesheet after. The kit still has no dashboard dependencies — it must not import from `features/`
— but it is the app's own code rather than a package, so changing a component means changing it
here.

### Appearance contract

The dashboard and login screen share a **System / Light / Dark** selector. System is the
default and follows OS changes live; explicit choices persist in local storage and sync across tabs.
The saved theme is applied before paint. Native date pickers, select controls and scrollbars inherit
the resolved color scheme, including portalled components.

- Field controls share `size="xs | sm | md | lg"` (28/36/44/52px minimum heights),
  `variant="outlined | filled | ghost"`, and the same default control radius.
- `borderRadius` accepts `none`, `sm`, `md`, `lg`, `xl`, `full`, any CSS radius, or a pixel number.
  `width` accepts `auto`, `full`, any CSS width, or a pixel number. `null`/omission leaves the
  component's stylesheet default intact. Explicit `style` wins; `className` remains available.
- Convenience fields apply `width` to their outer field layout, so percentage widths are not
  applied twice. Their `style`/`className` customize the control; compose `Field.Root` and the
  primitive parts when the label, description and control need independent layout overrides.
- Customize `--ui-radius-control`, `--ui-radius-surface`, `--ui-radius-dialog` (overlays: dialog,
  drawer, toast) and `--ui-radius-item` globally, or set an
  override on the specific trigger, popup, card, thumb, or other visual part.
- Buttons retain the pill shape and primary/secondary/ghost/danger variants, adding soft, success,
  warning, link, extra-small and loading states. An icon-only action takes `mode="icon"` — square at
  whatever `size` it carries, with no label padding — and still needs an accessible label.
- Use Base UI's native `disabled`, `required`, `onClick`, `value`/`onValueChange` and
  `checked`/`onCheckedChange` conventions. Composable primitive wrappers retain `render`, refs,
  and state callbacks for `className`/`style` where the underlying primitive supports them.
- All colors use semantic tokens (`surface`, `fg`, `border`, `primary`, `danger`, `success`,
  `warning`, etc.). Light/dark modes share the same components; reduced motion is respected.
  Put `.dark` on the document root so portalled menus, dialogs and toasts inherit the theme too.

```tsx
<Input label="Name" name="name" required size="md" borderRadius="lg" width="full" />
<Button variant="secondary" borderRadius="0.75rem" width="auto">Cancel</Button>
<Card borderRadius={20} width="min(100%, 40rem)">...</Card>
```

Base UI has no table/data-grid primitive: `Table` and `DataTable` intentionally use semantic HTML.
Badge, Card, Status, Textarea and page furniture extend the same appearance system. Do not add
pretend grid keyboard semantics or a second styling vocabulary.

### Component coverage

The kit includes accordion, alert dialog, autocomplete, avatar, button, checkbox/group,
collapsible, combobox, context menu, dialog, drawer, field, fieldset, form, input, menu, menubar,
meter, navigation menu, number field, OTP field, popover, preview card, progress, radio/group,
scroll area, select, separator, slider, switch, tabs, toast, toggle/group, toolbar, and tooltip.
Nonvisual providers and composition utilities are exported separately. Prefer direct imports to
keep feature bundles small. Accessible titles, descriptions and labels remain the caller's job.

Convenience controls (`Input`, `Select`, `SearchableSelect`, `Checkbox`, `Switch`) cover common
forms. Compound controls expose their styled parts (`Field.Root`, `Combobox.Input`,
`SelectPrimitive.Trigger`, `Tabs.Panel`); overlays use named exports (`DialogRoot`,
`DialogContent`, `DialogTitle`). The `*Content` overlay helpers include the portal and
positioner/backdrop; use the separate parts for custom placement. Input/Textarea reuse the kit's
enclosing `Field.Root`, or create one when used standalone, including with an `aria-label`.

## Playground

The playground uses AI SDK 7 with Chat Completions, Responses and Messages transports. Select a
public model; requests use normal gateway routing rather than pinning a deployment. Controls use
effective deployment metadata, constrained to capabilities shared by the eligible routing pool.
Parameters left blank use gateway/provider defaults. Messages requires an output-token limit.

Changing the transport or model, clearing the conversation, or leaving the page cancels the current
stream and discards local history and attachments. Nothing is saved in browser storage. Responses
requests use `store: false`; normal gateway usage accounting and operator retention policies still
apply. Regenerating or retrying sends a new, billable request.

The playground groups each question with its answer, with copy on user messages and copy/regenerate on assistant responses. The composer expands with a spring when text wraps and stays expanded until cleared. Attachments support previews, removal, paste and drop. Desktop Enter sends; Shift+Enter and mobile Enter insert a newline. Model settings and conversation reset sit beside the upward send button. Textarea height and the action rail commit together to keep the bottom-anchored composer stable during expansion. Settings are grouped into tabbed sections and
remain scoped to the ephemeral session. Responses render streaming Markdown, reasoning, sources and token usage when reported. TTFT is
measured from request start to the first text or reasoning delta; first-text latency excludes
reasoning-only deltas. Total duration includes network and gateway overhead. Request average divides all reported output tokens by the full request duration. Text speed estimates (output tokens minus reported reasoning tokens minus one) / (last text delta - first text delta), excluding initial wait and trailing stream closure. It requires multiple nonempty text chunks, a positive interval and valid usage; reasoning streams without reasoning usage show unavailable. Chunk batching and buffering can distort this client-observed estimate; it is not a provider decoding benchmark. Unreported reasoning is treated as zero only when no reasoning deltas were observed. Missing
usage is shown as unavailable, never estimated. The browser streams from the gateway directly, so there is no proxy in the path to buffer it.

Code highlighting runs in a shared, lazily loaded worker. It retains grammar state for completed
lines, reprocesses only the unfinished tail, and coalesces pending updates per block. Source text
appears immediately while colors catch up; unchanged lines retain their rendered tokens. Closing
the conversation releases the worker and its grammar state.

The versioned Bun patch for `ai@7.0.93` handles rejected telemetry-completion promises in browsers,
matching the SDK's existing Node behavior when no tracing subscriber exists. It prevents unhandled
rejections on cancellation without hiding inference errors from the chat.

## Commands

| Task | Command (from the repo root) |
|---|---|
| Dev | `bun run --filter @boelabs/dashboard dev` |
| Build | `bun run --filter @boelabs/dashboard build` |
| Serve the build | `bun run --filter @boelabs/dashboard start` |
| Typecheck | `bun run --filter @boelabs/dashboard typecheck` |
| Tests | `bun run --filter @boelabs/dashboard test` |
| Regenerate API types | `bun run --filter @boelabs/dashboard api:types` |

`build` and `start` both run under Bun: `next build` emits a standalone server, and `start`
(`scripts/start.ts`) copies the static assets beside it and runs `bun server.js` — exactly the three
steps the Dockerfile performs. `dev` and `start` are scripts rather than shell one-liners because
Bun's shell expands `$VAR` but not `${VAR:-default}`, and both need a port default: `DASH_PORT` in
development, `PORT` in production, 3001 either way.

The dashboard needs a running gateway with `DASH_ENABLED=true` and a `DASH_ROOT_USER`, and it needs
to be told where that gateway is:

```bash
GATEWAY_URL=http://localhost:4000
```

The gateway needs nothing in return. `.env.example` here is the full list — copy it to `.env` and
both `bun run dev` and `bun run start` pick it up. See also
[Environment variables](../docs/content/docs/(api)/(reference)/reference-environment.mdx).

## Things that will bite you

- **A Server Component cannot read a runtime value out of a `"use client"` module.** It gets a client
  reference, not the value. That is why the table headers the skeletons use, and helpers like
  `runtimeTone`, live in `common.ts` rather than beside the components that also use them.
- **Read the URL on the server.** Each page parses its query string with a zod schema and passes the
  result down as props. `useSearchParams()` in a control resolves only at request time, which pulls
  that control out of the route's shell on every cold load — the build says so.
- **Never read configuration at module scope, and never through `NEXT_PUBLIC_*`.** A value captured
  when a module is first evaluated can be captured during a prerender and baked into the build, and
  `NEXT_PUBLIC_*` is substituted into the client bundle by definition. Both turn one portable image
  into one image per environment. Call `gatewayInternalUrl()` per request on the server, and
  `gatewayUrl()` from `shared/config/browser.ts` in the browser.
- **`src/proxy.ts` must let `/api/auth` through.** It is the sign-in relay itself, so gating it
  would make signing in require a session.
- **`AGENTS.md` and `CLAUDE.md` here are written by `next dev`.** They point at version-matched Next
  documentation in `node_modules/next/dist/docs`; commit them with your work rather than deleting
  them.
- **`openapi-typescript` runs through `bunx`, pinned.** The repo's root `js-yaml` override breaks the
  Redocly parser it depends on when it resolves through the workspace.
- **This app does not extend `packages/tsconfig`.** Its `exactOptionalPropertyTypes` and
  `noUncheckedIndexedAccess` fight React and third-party component props; relaxing them in the shared
  config would weaken the gateway, which AGENTS.md forbids. Strict mode still applies here.
