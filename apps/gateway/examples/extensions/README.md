# Example extensions

Four ready-to-mount runtime extensions that show what the canonical-layer hook system can do. They
are deliberately non-trivial: each one is something you might actually want in front of a model
gateway. Together they exercise every hook (`onCanonicalRequest`, `onCanonicalResponse`,
`onStreamEvent`, `onImageOutput`, `onError`).

Upload each module and configure an instance through the Admin API (master key). For example, the
firewall:

```bash
curl -X POST "$GATEWAY/admin/extensions/artifacts" \
  -H "Authorization: Bearer $MASTER_KEY" -H "Content-Type: application/json" \
  -d "$(jq -n --arg code "$(cat prompt-firewall.mjs)" '{ key: "promptfirewall", code: $code }')"

curl -X POST "$GATEWAY/admin/extensions/instances" \
  -H "Authorization: Bearer $MASTER_KEY" -H "Content-Type: application/json" \
  -d '{ "id": "prompt-firewall", "definition": "promptfirewall", "priority": 10,
        "match": { "callTypes": ["chat"] },
        "config": { "action": "sanitize" } }'
```

Because hooks run on the **canonical** request/response (after each public wire format is normalized),
every chat instance below applies uniformly to `/v1/chat/completions`, `/v1/responses` and
`/v1/messages` — you write the logic once.

Instances run in `priority` order (ascending). A sensible default ordering:

| Priority | Extension | Why here |
|---|---|---|
| 10 | `prompt-firewall` | Inspect/neutralize input **first**, before anything else reads it. |
| 20 | `pii-vault` | Mask PII **after** the firewall cleaned the text, before it leaves the gateway. |
| 50 | `tiered-image-watermark` | Image path only; order vs. chat hooks is irrelevant. |
| 90 | `provenance-watermark` | Stamp the reply **last**, once its content is final. |

---

## 1. `prompt-firewall.mjs` — injection/jailbreak guard

`onCanonicalRequest`. Scans `user`/`tool` text for known prompt-injection phrases and either
neutralizes the span (`action: "sanitize"`, default) or rejects the whole request
(`action: "block"`).

```json
{ "action": "sanitize", "replacement": "[blocked]",
  "extraPatterns": ["transfer\\s+all\\s+funds"], "scanRoles": ["user", "tool"] }
```

- `extraPatterns` are regex strings, validated at startup (a bad regex fails fast).
- **Blocking caveat:** today a thrown hook error surfaces to the client as HTTP 500 with a generic
  message — the runtime wraps every hook error as a server error. The call is still blocked. If you
  need a clean 4xx, prefer `sanitize`, or front the gateway with a dedicated WAF.

## 2. `pii-vault.mjs` — tokenize in, restore out

`onCanonicalRequest` + `onCanonicalResponse` + `onStreamEvent` + `onError`. Replaces PII (email,
credit card, phone, IPv4) with opaque tokens (`«V1»`, `«V2»`, …) so the **upstream provider never
sees raw values**, then restores them in the reply so the client sees normal text.

```json
{ "types": ["email", "creditcard", "phone", "ipv4"], "scanRoles": ["user", "tool"] }
```

Highlights worth reading the code for:

- **Streaming restore across chunk boundaries.** A token can be split across two deltas
  (`…«V` then `1»…`). The stream hook holds back any unclosed `«…` tail and flushes it once the
  token closes, so restoration is correct without buffering the whole response.
- **Lifecycle discipline.** Per-request state lives in a module map and is **always** torn down — on
  the response hook, on the final stream chunk, *and* via `onError` if the request fails mid-flight.
  This is the part naive implementations leak.

> Detectors are heuristic regexes meant as a demo. For production PII, swap in a real detector and
> consider format-preserving tokens.

## 3. `provenance-watermark.mjs` — invisible signature in text

`onCanonicalResponse` + `onStreamEvent`. Embeds a short tag into assistant text using zero-width
characters (ZWSP = bit 0, ZWNJ = bit 1, WORD JOINER = sentinel). The text reads identically to a
human but can be traced back to the producing instance.

```json
{ "tag": "unifiedgw:demo", "position": "start" }
```

The streaming hook watermarks **once**, on the first content delta, then leaves the stream untouched.

**Decoder** (run on any pasted reply to recover the tag):

```js
const ZERO = String.fromCharCode(0x200b); // ZWSP        -> 0
const ONE = String.fromCharCode(0x200c); //  ZWNJ        -> 1
const MARK = String.fromCharCode(0x2060); // WORD JOINER -> sentinel

function decodeWatermark(text) {
  const i = text.indexOf(MARK);
  if (i < 0) return null;
  let bits = "";
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === ZERO) bits += "0";
    else if (text[j] === ONE) bits += "1";
    else break;
  }
  const bytes = [];
  for (let b = 0; b + 8 <= bits.length; b += 8)
    bytes.push(parseInt(bits.slice(b, b + 8), 2));
  return Buffer.from(bytes).toString("utf8");
}
```

> Provenance/leak-tracing, **not** DRM: zero-width marks survive copy-paste but a motivated adversary
> can strip them. Not cryptographically signed.

## 4. `tiered-image-watermark.mjs` — preview stamp by tier

`onImageOutput`. Composites a visible diagonal watermark over generated images **unless** the caller
is privileged (the master key, or a virtual key whose name is allow-listed). The classic
"free tier = watermarked preview, paid tier = clean file" pattern, enforced at the gateway.

```json
{ "text": "PREVIEW", "allowlist": ["acme-production"], "opacity": 0.28 }
```

- Branches on `ctx.auth` — the only example that turns identity into per-request policy.
- A visible overlay legitimately re-encodes the image (we change pixels), which is what
  `onImageOutput`'s full output contract is for. Stamping *metadata* without re-encoding is a
  different job — see your private metadata extension for that pattern.
- Set `watermarkMaster: true` to also stamp master-key traffic (default: master is exempt).
```
