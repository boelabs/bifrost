# Catalog agent runbook

The procedure the scheduled catalog agent follows, twice a day, to keep the provider catalogs
(`apps/gateway/src/adapters/*/catalog.json`) in step with what each provider publishes. A person
syncing by hand follows it too. [AGENTS.md](../../../../../AGENTS.md) still applies in full; this
file adds the rules specific to the job.

Merging to `main` deploys production. Every number you write is billed to customers, and every
parameter you declare is sent to a provider. When in doubt, leave the value out and say so in the
pull request: a missing field is a known gap, a wrong one is an incident.

## 1. Scope

You may:

- Add a model that the provider's own API accepts under that exact id, including transcription,
  realtime (live voice), embedding, rerank, image and video models when the provider's adapter
  already serves that operation.
- Correct `pricing`, `maxInputTokens`, `maxOutputTokens`, `capabilities`, `parameters` and
  `reasoning` of an existing entry, when the provider's own docs say otherwise.
- Mark a model `deprecated: true` when the provider announced its deprecation or retirement.
- Regenerate the Vercel and OpenRouter snapshots with their scripts.

You must not:

- Touch any file other than a `catalog.json`. No code, tests, docs, schemas, lockfiles, workflows.
  If a correct catalog needs a code or schema change (a price field the schema lacks, a parameter
  the adapter cannot send), leave it out and list it under "Out of scope" in the pull request.
- Remove a model from a hand-maintained catalog, or clear `deprecated` on one. Operators' deployments
  reference these ids; retirement is a flag, and only a human reverses it.
- Add a provider, a transport, or a new operation to a model.
- Tag, release, or touch `release.yml`. Merges go to `main` only.
- Bypass branch protection, force-push, or merge with any check red or pending.

## 2. Sources

Aggregators tell you **that** something changed; only the provider tells you **what**.

| Use for | Source |
|---|---|
| Discovering candidates | `catalog:sync` report (Vercel AI Gateway, OpenRouter, models.dev) |
| Every number and every field you write | The provider's own docs: the URLs in each catalog's `provider.docs`, plus its models page, pricing page, API reference, changelog and deprecations page |
| Azure prices | The Retail Prices API, `https://prices.azure.com/api/retail/prices?$filter=contains(meterName,'<model>')`; take the lowest Global (`glbl`) meter. A model with only Data Zone meters stays unpriced. Azure's HTML pricing pages render prices with JavaScript and show nothing |

Rules learned the hard way:

- **Standard rate, peak basis.** Never batch, flex, off-peak, cached-only or promotional rates
  passed off as standard. DeepSeek uses its peak price. Fast or priority tiers are a premium on
  the same model, not a cheaper one.
- **Ids, not aliases of features.** `-fast`, `-pro`, `:batch`, `:free`, `-decisions` and similar
  suffixes on aggregators are usually a service tier, a mode or a different endpoint on an existing
  model. Add an entry only when the provider's API reference or models page lists that exact id.
  Match the provider's spelling and case (`MiniMax-M3.1-Flash`, not `minimax-m3.1-flash`).
- **No number, no field.** When the provider publishes no price or limit, leave it absent. Do not
  infer one from an aggregator or from a sibling model.
- **Declare only documented parameters,** and never make an entry stricter than the provider: a
  parameter the provider documents as "ignored" or "no effect" is `{"mode": "ignored"}` with a short
  note; one it rejects is `false`; one it accepts is `true`. Do not flip an existing `true` to
  `false` or `ignored` unless the provider's docs say it is rejected or ignored in every mode.
- **Reasoning specs** (`kind`, `levels`, `bodyField`, `effortField`) follow the provider's API
  reference. Include `none` in `levels` only if the model has a real off switch. Copy the shape of
  an existing entry of the same provider. Never merge an entry with `needsHumanReview`: verify the
  field and remove the marker, or leave the model out.
- **Dated price changes** the schema cannot express (a price that doubles on a date) go in the
  pull request, not in `notes`.

## 3. Procedure

### 3.1 Prepare

```bash
git fetch origin
git checkout main && git reset --hard origin/main   # a fresh cloud checkout; never do this with local work
command -v bun || npm install -g bun@1.4.0
bun install --frozen-lockfile
```

**GitHub access.** In a cloud session, `gh` commands built on GraphQL (`gh pr list`, `gh pr create`,
`gh pr checks`, `gh pr view`, `gh pr merge`) fail with 403. Use the GitHub tools the session provides
(`list_pull_requests`, `create_pull_request`, `update_pull_request`, `pull_request_read` with
`get` / `get_check_runs`, `merge_pull_request`) or the REST API through `gh api repos/boelabs/bifrost/...`.
Locally, the `gh pr` commands below work as written.

Look for an open pull request whose head branch starts with `chore/catalog-sync`. If one exists, do
not open a second one:

- If it is green, `mergeStateStatus` is `CLEAN`, and `catalog:guard` passes on it, merge it (3.6),
  pull `main`, and continue with a fresh run.
- Otherwise it is waiting for a human. Check out its branch, merge `origin/main` into it, and add
  this run's changes there (push to the same branch, update its description). Do not merge it.

### 3.2 Discover

From `apps/gateway`:

```bash
bun run catalog:sync                  # writes .source/catalog-sync/REPORT.md
bun run catalog:sync:vercel:write     # regenerates the Vercel snapshot
bun run catalog:sync:openrouter:write # regenerates the OpenRouter rerank snapshot
```

If a source fetch fails or is incomplete, the snapshot scripts refuse to write; leave that snapshot
alone this run.

**Then sweep every hand-maintained provider. This step is mandatory on every run,** even when the
report shows nothing: aggregators list new models late and deprecations never. For each provider,
read its changelog or release notes, its models page and its deprecations page for anything dated
since the last hand-made catalog change on `main` (`git log --format='%cs %s' --
apps/gateway/src/adapters/*/catalog.json`, skipping snapshot-only syncs). Run one sub-agent per
provider in parallel when you can:

| Provider | Start from |
|---|---|
| anthropic | `https://platform.claude.com/docs/en/release-notes/api`, `.../about-claude/models/overview`, `.../about-claude/model-deprecations` |
| openai | `https://developers.openai.com/api/docs/changelog`, `.../docs/models`, `.../docs/deprecations` |
| azureopenai, azurefoundry | The report's Azure sections (below), `https://learn.microsoft.com/azure/foundry/openai/concepts/model-retirement-schedule`, and for each model the page's own section or how-to |
| googleaistudio | `https://ai.google.dev/gemini-api/docs/changelog`, `.../docs/models` (its "Live API" section), `.../docs/deprecations`, `.../docs/transcribe`, `.../docs/live-api/live-transcribe`, `.../docs/live-api/capabilities`, `.../docs/live-api/tools`, `.../docs/live-api/live-translate` |
| deepseek | `https://api-docs.deepseek.com/updates`, `.../news/`, `.../quick_start/pricing` |
| moonshot | `https://platform.kimi.ai/docs/platform-changelog.md`, `.../docs/models.md` |
| zai | `https://docs.z.ai/release-notes/new-released`, `.../guides/overview/pricing` |
| minimax | `https://platform.minimax.io/docs/release-notes/models`, `.../docs/faq/models` (its "Retired Models" table) |

Pages move; follow redirects and the provider's own navigation. A provider you could not read is
reported as such, never as "nothing new".

**Sweep every modality, not just chat models.** Speech-to-text is the family aggregators miss most:
they rarely list transcription models, and never their live or realtime variants. On every run, look
on each provider's models page and changelog for transcription models (file and live/realtime:
`*-transcribe`, `*-transcribe-live`, `*-live-transcribe`, `whisper-*`, "speech-to-text"), and the same
for live voice models (`*-live`, `*-live-*`, `*-native-audio-*`, `*-realtime*`, `*-live-translate*`),
embeddings, rerankers, image and video models. Known transcription models today: OpenAI
`gpt-transcribe`, `gpt-live-transcribe` and the deprecated `gpt-4o-*-transcribe`; Google
`gemini-3.5-transcribe` and `gemini-3.5-transcribe-live`. Known live voice models: Google
`gemini-3.8-live`, `gemini-3.8-live-extended-thinking`, `gemini-3.1-flash-live-preview`,
`gemini-2.5-flash-native-audio-preview-12-2025` and `gemini-3.5-live-translate-preview`; OpenAI
`gpt-realtime-2.1`, `gpt-realtime-2.1-mini`, `gpt-realtime-2` (out of scope until the OpenAI adapter
serves realtime conversations).

**Azure is read for you.** The aggregators never list Azure's deployment ids, so `catalog:sync` reads
Microsoft's own list (`https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure`,
both tabs) and reports "Listed by Azure, missing from the catalog" and "Retired by Azure, not
deprecated here". Every id in those sections is a candidate. One you leave out because Bifrost cannot
serve it (no operation or transport for it) goes under "Out of scope" with the reason, so a human adds
it to `AZURE_LISTING_UNSERVED`. If the report says the list could not be read, read the page by hand
this run.

Candidates are: new models in the report, models the providers announced, deprecations the
providers announced, and "stale essentials" in the report. Most stale essentials are aggregator
noise (halved fast-mode prices, off-peak rates, parameters nobody documents); verify each one
against the provider before changing anything, and mention the rejected ones in one line.

### 3.3 Research each candidate

For a new model, establish from the provider's own pages, with a URL for each:

1. The exact id the API accepts, and the release date.
2. Pricing per 1M tokens: input, output, cache read, cache write, and any long-context tier with
   its threshold.
3. Context window (max input) and max output tokens, as exact numbers.
4. Capabilities: tools, vision, reasoning, structured outputs (JSON schema), strict tools.
5. Reasoning control: can it be turned off, which effort values, which request field.
6. Each request parameter: accepted, ignored, or rejected; allowed values where the API restricts
   them (for example `tool_choice`).
7. Which API the model is served on, if the provider splits them (Chat Completions vs Responses).

For a transcription model, the `audio.transcribe` profile replaces items 3 to 6. Establish:

1. Whether it transcribes files (`/audio/transcriptions`, Gemini's Interactions API; the
   `audio.transcribe` operation) or live audio (a realtime WebSocket, Gemini's Live API; the
   `audio.transcribe.realtime` operation, served today by the Google adapter only). A live model on
   a provider whose adapter has no realtime transcription goes under "Out of scope".
2. Pricing per 1M tokens for audio input and text output. A model billed per minute has no field
   for it: leave it out and say so.
3. `responseFormats` it returns, whether it streams (`supportsStreaming`), and the timestamp
   granularities it produces (`timestampGranularities`).
4. Vocabulary hints (`supportsKeywords`, and `maxKeywords` when the provider caps them), multiple
   language hints (`supportsLanguageHints`), modes beyond verbatim (`modes`), and speaker
   diarization (`diarized_json` in `responseFormats`).
5. Every pair of features the provider documents as rejected together (`incompatibleFeatures`, for
   example vocabulary with diarization), and the upload limit (`maxFileBytes`).

A live model's `audio.transcribe.realtime` profile declares `supportsKeywords`, `maxKeywords`,
`supportsLanguageHints`, `modes`, the `turnDetection` values it accepts (`server_vad`, `manual`) and
`maxUpstreamSessionSeconds` when the provider caps one connection.

Copy the closest existing transcription entry of the same provider; the adapter decides how each
field reaches the provider, so a new id on an adapter that already transcribes needs no code.

For a live voice model (speech in, speech out; the `audio.converse.realtime` operation, served today
by the Google adapter only), the profile replaces items 3 to 7. Establish:

1. Pricing per 1M tokens by modality: text, audio and image input (`inputCentsPerMTokens`,
   `audioInputCentsPerMTokens`, `imageInputCentsPerMTokens`), text and audio output
   (`outputCentsPerMTokens`, `audioOutputCentsPerMTokens`).
2. What it answers with natively (`outputModalities`; Gemini's native-audio models: `["audio"]`
   only), and its prebuilt `voices`.
3. Whether it takes instructions, function tools, Google Search, text and image input, and input
   transcription with vocabulary (`supportsInstructions`, `supportsTools`, `supportsGoogleSearch`,
   `supportsTextInput`, `supportsImageInput`, `supportsInputTranscription`, `maxKeywords`).
4. How function calls run: `functionCalling: "non_blocking"` when the model only supports
   asynchronous calls (it errors on BLOCKING); otherwise leave it out.
5. The `reasoning.effort` values it accepts (`reasoningEfforts`), or none when it must be omitted.
6. Turn detection it supports (`server_vad`, `semantic_vad`, `manual`), whether it resumes sessions
   and compresses context (`supportsSessionResumption`, `supportsContextCompression`), and the
   per-connection cap (`maxUpstreamSessionSeconds`).
7. For a translation model, `translation: true` (sessions must name a target language).

Copy the closest existing live entry of the same provider.

For a deprecation: the announcement date, the shutdown date, the replacement, and whether requests
to the old id are routed elsewhere after shutdown.

### 3.4 Apply

- Copy the structure of the closest existing entry from the same catalog and change only what the
  provider documents differently. Place a new model next to its family.
- A deprecated entry keeps its `operations` and `pricing` untouched and gets `"deprecated": true`
  and a `notes` line in the established style, for example:
  `"OpenAI deprecated gpt-x; it shuts down on 2027-01-14 (replacement: gpt-y)."`
- Edit JSON with a script or by hand, then always run `bun run format` from the repository root.

### 3.5 Verify

From the repository root, in this order. Every step must pass before the next:

```bash
bun run format
git status --short            # restore anything that is not a catalog: git checkout -- <path>
bun run check
bun run typecheck
bun run test
bun run --filter @boelabs/bifrost catalog:validate
bun run --filter @boelabs/bifrost catalog:guard
```

`catalog:guard` compares your tree with `origin/main`:

| Exit | Meaning | What you do |
|---|---|---|
| 0 | Catalog-only change, no risky moves | Open the pull request and merge it when CI is green |
| 2 | Plausible but risky: a price moved by 1.5x or more, or a price disappeared | Open the pull request, put the findings under "Needs human review", do not merge |
| 1 | Not a valid catalog sync: a non-catalog file, a removed model, an undone deprecation, a new catalog | Fix it. If you cannot, discard the change and report it |

If a test fails because of your catalog change (a test pins a model or a price), you may not edit
the test: leave the pull request open, unmerged, and explain.

### 3.6 Pull request and merge

If nothing changed, stop: no branch, no pull request. Report "no changes" with the list of what you
checked.

Otherwise:

```bash
git checkout -b chore/catalog-sync-$(date -u +%Y-%m-%d-%H%M)
git add apps/gateway/src/adapters
git commit -m "Sync model catalogs for $(date -u +%Y-%m-%d)"
git push -u origin HEAD
gh pr create --base main --title "..." --body-file <file>
```

The title names what changed ("Add MiniMax M3.1 Flash and sync catalogs for 2026-10-20"). The body
follows `.github/PULL_REQUEST_TEMPLATE.md`, kept short:

- **Summary:** each added, corrected or deprecated model with its key numbers, and the snapshot
  counts (added, no longer listed).
- **Sources:** one provider URL per model you changed.
- **Needs human review:** the `catalog:guard` findings, if any. Omit when empty.
- **Rejected:** the report's proposals you checked and did not apply, in one line each.
- **Out of scope:** things you found that need code or schema changes.

No agent names, model names or "generated with" footers in the branch, commit or pull request
(AGENTS.md §1). The platform may append a "Generated by …" line to the body you send: read the pull
request back and remove it.

To merge (only when `catalog:guard` exited 0):

1. **Wait for the pull request's own checks.** CI runs twice: the run for the branch push skips all
   its jobs by design (the pull request run covers them), so its "skipped" results are not a verdict.
   The required checks are *Lint, typecheck & unit tests*, *Integration tests* and *Build container
   images* from the `pull_request` run. Poll every minute, for up to 30 minutes, until all three are
   completed; locally, `gh pr checks <number> --watch`.
2. **All three succeeded and the merge state is clean** (`mergeable_state: "clean"` over REST,
   `mergeStateStatus: CLEAN` from `gh pr view`). Anything else: do not merge.
3. **Squash-merge** with the pull request title as the commit title and an empty body
   (`gh pr merge <number> --squash --delete-branch` locally). Delete the head branch if it still
   exists. A cloud sandbox is discarded after the run: skip local cleanup.

If a check fails, read its log. Fix it on the branch if the cause is your catalog change, then
verify again from 3.5. If it is unrelated to your change, leave the pull request open and say so.
Never re-run a check to get a lucky pass.

### 3.7 Report

End the run with a few lines: what was added, corrected or deprecated, the pull request link and
whether it was merged or is waiting for a human (and why), and anything out of scope. Then one line
per provider from 3.2: what you read and what you found, or that the page could not be read.
