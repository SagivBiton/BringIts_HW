# `@llm-query/adapters-gemini` — guest HTTP generate

Gemini v1 is **one HTTP step**: `GET https://gemini.google.com/app` (bootstrap ids) then `POST StreamGenerate`. No browser. No Google API key. Guest-only.

Site quirks (FdrFJe / `bl`, nested StreamGenerate JSON, `rc_` answer arrays) live **in this package**. The HTTP worker only calls `geminiHttpStepMeta.run`.

## Adapter (`src/adapter.ts`)

### `plan`

- New chat: `affinity: 'none'`, one step `{ id: 'generate', worker: 'http', purpose: 'generate' }`
- Follow-up (`conversation_id` / `continuing`): `affinity: 'session'`, `session_key` = conversation id, `uses_session: true`

Timeout is `GLOBAL_DEADLINE_MS` (120s).

### `resolvePrompt`

`buildPromptWithHistory` — Gemini’s public guest POST is not a full documented continue API in this service, so prior turns are inlined into the prompt when needed. Parsed `c_` / `r_` ids are stored on `target_session` for later jobs.

### `parse`

StreamGenerate is nested JSON-ish text, not a stable public schema. The parser:

1. Prefers assistant text inside `rc_…` arrays (`extractRcAnswers`) — better than “longest quoted string”
2. Falls back to scoring flattened quoted strings with `isProtocolToken` filters (`c_`, `r_`, `wrb.`, UI chrome “Longer”/“Shorter”, URLs, locale tags, hex ids)
3. `cleanGeminiAnswer` strips weather-card / `googleusercontent.com/card_content` prefixes
4. `parse: false` adds `payload: { streamBody, modelId }` — structured dump, not base64 wire

### `classify`

Empty body → `EMPTY_RESPONSE`. Captcha / “verify you are human” → `TARGET_BLOCKED`. Otherwise unclassified capture is an internal fingerprint (orchestrator still requires real `response_text` after parse).

**Never** treat a challenge page as the answer.

## Step (`src/steps/generate.http.ts`)

1. Fetch `/app` via `createProxiedFetch(proxyUrl)`
2. Regex `"FdrFJe"` (`f.sid`) and `"cfb2h"` (`bl`). Missing → `bootstrapFailed` + empty `streamBody` (empty path → classified failure)
3. POST `BardFrontendService/StreamGenerate` with `f.req` envelope, locale `en-US`, dummy attestation tokens (guest research path)
4. Return `{ streamBody, httpStatus }`

`fetchImpl` is injectable for tests.

## Proxied fetch (`src/proxied-fetch.ts`)

Gemini `Set-Cookie` / bootstrap headers can exceed undici’s default **16KiB** header cap. This wrapper always uses undici with `maxHeaderSize` 256KiB, and `ProxyAgent` when the lease URL is a real proxy. `direct` / localhost skip the proxy.

## Tests

- `adapter.spec.ts` — parse/classify on fixtures
- `generate.http.spec.ts` — bootstrap + POST with fake fetch
- `proxied-fetch.spec.ts` — direct vs proxy URL
- `gemini.live.spec.ts` — opt-in `LIVE_INTEGRATION=1`

## Related

- [worker-http](../../apps/worker-http/README.md)
- [DESIGN.md](../../DESIGN.md) §4 Gemini POC facts
