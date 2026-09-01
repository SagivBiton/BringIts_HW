# ChatGPT HTTP Guest POC (curl-impersonate)

Findings from August 2026 spike. **Not implemented in the repo** — kept for a future `generate.http.ts` step.

## Goal

Guest ChatGPT send without full Firefox SPA per job:

1. **curl-impersonate** (Firefox TLS profile) for HTTP
2. **Native POW** (hashcash-style, from `client-shared` `generateAnswer` / `p_`)
3. **Turnstile dx mint** via pluggable backend:
   - **B (pool):** inlined Turnstile VM in headless Firefox on `https://chatgpt.com` origin
   - **D (jsvm):** same VM in Node `vm` (failed)

## Protocol (unauth mweb)

Per prompt (from HAR + live tests):

```
GET  https://chatgpt.com/                          → cookies, shell
POST /unauth-mweb/sentinel/chat-requirements/prepare → { prepare_token, turnstile.dx, proofofwork }
     body: { "p": "<requirementsKey>" }
POST (mint)                                        → turnstile token (client-side, not in response bodies)
POST /unauth-mweb/sentinel/chat-requirements/finalize
     body: { prepare_token, proofofwork, turnstile }
POST /unauth-mweb/conversation/prepare               → conduit_token JWT
POST /unauth-mweb/conversation/updates?operationId=…
     form: prompt, chatRequirementsToken, conversationState, oai-session-id, …
     Accept: text/vnd.openai.web-mobile-partial+html
```

- `oai-session-id` stable across follow-ups; proof/turnstile/conduit/operationId change per send.
- Tokens are **one-shot** — no replay of finalize/updates bodies.
- `prepare_token` is echoed to finalize unchanged; server mints new `token` (= `chatRequirementsToken`).

## curl-impersonate

- Use bundled binary from `node-curl-impersonate` package (`curl-impersonate-firefox-linux-x86`), not system `pacman` (needs sudo).
- Constructor API is `new CurlImpersonate(url, { method, impersonate: 'firefox-117', headers })` → `makeRequest()` — easy to wrap with cookie jar `-c`/`-b`.
- **Proven:** `GET https://chatgpt.com/` → 200, ~500KB shell, title "ChatGPT", no CF challenge page (vs plain `fetch`/urllib 403).

## Native POW

From `client-shared-*.js` (HAR extract `turnstile-CIoVD9UN.js` sibling bundle):

```javascript
// p_(e) — FNV-1a style
function p_(e) {
  let t = 2166136261;
  for (let n = 0; n < e.length; n++) t ^= e.charCodeAt(n), t = Math.imul(t, 16777619) >>> 0;
  t ^= t >>> 16; t = Math.imul(t, 2246822507) >>> 0;
  t ^= t >>> 13; t = Math.imul(t, 3266489909) >>> 0;
  t ^= t >>> 16;
  return (t >>> 0).toString(16).padStart(8, '0');
}

// check: p_(seed + g_(config)).substring(0, difficulty.length) <= difficulty
// proof output: `gAAAAAB${base64Config}~S`
```

`g_(config)` = base64(JSON.stringify(configArray)). Config array ~27 slots (UA, scripts, sessionId, etc.) — see HAR-decoded `p` token.

**Proven:** native solver matches low-difficulty puzzles in unit tests; live prepare returns `proofofwork.seed` + `difficulty` (e.g. `"07a120"`).

## Turnstile dx mint — critical: `requirementsKey`

From `client-shared` (`B_`, `H_`, turnstile module):

```javascript
function B_(e, t) {
  let n = { ...e, prepare_token: e.prepare_token };
  D_(n, t);  // WeakMap.set(requirements, requirementsKey)
  return { requirements: n, requirementsKey: t };
}
// turnstile H(e, dx): XOR key = O_(requirements) = WeakMap.get(requirements) = t
// t is the `p` token sent in prepare REQUEST body (from getRequirementsTokenBlocking), NOT prepare_token from response
```

**Wrong:** `const t = () => ''` → JSON.parse error on decoded dx (base64 error blob).  
**Right:** `const t = () => requirementsKey` where `requirementsKey` is the exact `p` sent to prepare.

Turnstile chunk discovery (live, Aug 2026):

```
GET / → parse client-*.js or client-shared in HTML/perf
GET /unauth-mweb/assets/client-shared-<hash>.js → regex turnstile-<hash>.js
e.g. turnstile-Cwm9KGP4.js (hashes rotate)
```

Turnstile module (`turnstile-*.js`) is ~5KB; dx path runs embedded VM (`H`, `W`, `I`, `U`) — **not** Cloudflare widget when `turnstile.dx` is present.

### Backend B (pool) — recommended

1. Fetch live `turnstile-*.js` via curl-impersonate.
2. Strip `import`/`export`, stub `e` (uuid), set `t = () => requirementsKey`.
3. `page.goto('https://chatgpt.com/')` then `page.evaluate(new Function(...))` — **must be https origin** (`about:blank` → `SecurityError: operation is insecure`).
4. Valid mint: ~1200+ char base64 token (not ~96 char error blob).

**Proven:** prepare → POW → pool mint → finalize 200 with ~2.4KB `token`.

### Backend D (jsvm) — not viable yet

Node `vm` with same inlined script fails: `TypeError: Cannot read properties of undefined`, or short base64 error strings. Needs full browser globals or `isolated-vm` + entire `client-shared` (200KB+). Prefer pool for dx mint.

## HTTP headers & session

| Header | Notes |
|---|---|
| `OAI-Session-Id` | UUID per guest session; stable across prompts |
| `x-worker-version` | Capture from prepare response; do **not** hardcode HAR value |
| `X-Web-Mobile-Conversation-Document-Affinity` | Wrong/stale value → 403 on updates; omit if unknown |
| `Cloudflare-Workers-Version-Overrides` | Only when `workerVersion` known from live responses |
| `x-conduit-token` | From `conversation/prepare` |
| `chatRequirementsToken` | Form field on updates (= finalize `token`) |

`conversation/prepare` works with minimal headers (no mobile worker overrides).  
`conversation/updates` with stale affinity headers → `403 Invalid conversation document affinity`.  
Without affinity headers → **200** but DPU stream may contain `data-failure-status="400"` `server_upstream_response_status` (model turn failed upstream).

## Live test summary (2026-08-29)

| Step | curl-impersonate | Backend B (cold) | Backend B (warm) | Backend D |
|---|---|---|---|---|
| GET / | ✅ | — | — | — |
| prepare | ✅ | — | — | — |
| POW | ✅ | — | — | — |
| Turnstile mint | — | ✅ (~2.6–3.4s) | ✅ (~0.75–1s after warmup) | ❌ |
| finalize | ✅ | ✅ | ✅ | — |
| conversation/prepare | ✅ | ✅ | ✅ | — |
| conversation/updates | ⚠️ upstream 400 in DPU | ⚠️ same | ⚠️ same | — |

**Blocker for full greeting:** updates returns partial HTML with failure attribution, not assistant text. Likely finalize/updates field mismatch or session binding — compare live POST bodies to HAR `chatgpt.com_Archive [26-08-27 20-10-06].har`.

**Note:** Playwright full-send (`runChatgptGuestTurn`) also failed same day (composer not visible) — site/CF may have shifted; re-validate baseline before next spike.

## Warm mint pool experiment (2026-08-29 follow-up)

Isolated spike tested “warm one Firefox page per proxy; mint = `page.evaluate` only” vs cold mint (goto per job). Code removed; findings kept here.

### Measured (direct proxy, prompt `"hello"`)

| Mode | Mint latency | Warmup | Updates upstream |
|---|---|---|---|
| **Cold** (goto each mint) | ~2.6–3.4s | — | **400** |
| **Warm** (page per proxy) | ~0.75–1s | ~1.9s once per proxy | **400** |

Both modes: mint + finalize succeed; `conversation/updates` HTTP 200 with `data-failure-status="400"` / `server_upstream_response_status=400`; no assistant text.

### Cold vs warm mint trade-offs

| | Cold mint | Warm mint |
|---|---|---|
| **Per-job cost** | Paid every mint (goto + evaluate) | Evaluate only after warmup |
| **RAM** | Spike per job, released | Standing Firefox + page per proxy (~hundreds of MB each) |
| **Scaling** | Stateless — any worker | Sticky — slot lives on worker that warmed it |
| **Complexity** | Low | Pool lifecycle: warm, re-warm, health, shutdown |
| **Fixes updates 400?** | No | No |

Warm mint is ~2–3× faster on the mint step only. It does **not** unblock the HTTP pipeline.

### Architecture: full browser vs HTTP + mint split

**Production v1 (DESIGN.md):** `worker-browser` → `generate.browser.ts` → full Firefox SPA per job (launch, goto, type, wait, close). One context; site expects it.

**HTTP guest POC:** curl-impersonate for protocol + Firefox only for Turnstile dx VM. Would be a hybrid (`worker-http` + mint pool).

| Path | Mean latency (bench) | RAM | Status |
|---|---|---|---|
| Full Firefox send | **4.84s** | ~1GB | v1 production path |
| Firefox mint + HTTP spend | **5.40s** (slower) | ~1GB (same) | Spike only |
| HTTP POST alone | ~1.7–2s | — | Not a full turn |

**Conclusion:** Full-browser send is the better default. The HTTP split adds two stacks and session-sync risk without beating full-send on latency or RAM (mint still launches Firefox). HTTP guest only makes sense if `conversation/updates` returns a real greeting **and** sustained QPS justifies the complexity.

**Efficiency without protocol split:** warm **full-send** browser per proxy (reuse loaded page for type/send), not warm mint-only on a broken HTTP pipeline. Same warming idea; browser still does the whole turn.

## Suggested package layout (future)

```
packages/adapters-chatgpt/
  CHATGPT_HTTP_GUEST_POC.md          # this file
  src/
    http/
      curl-transport.ts              # curl-impersonate wrapper + cookie jar
      discover-turnstile.ts          # client-shared → turnstile URL
      sentinel-client.ts             # prepare/finalize/conduit/updates
      guest-http-pipeline.ts         # orchestrates one turn
      cookie-jar.ts                  # Netscape → Playwright cookies
    pow/
      solver.ts
    challenge/
      mint.interface.ts
      mint-pool.ts                   # backend B
      mint-jsvm.ts                   # backend D (optional)
      turnstile-inline.ts
    steps/
      generate.http.ts               # worker-http step (future)
  scripts/
    test-http-guest.ts               # CLI: --backend pool|jsvm
```

Execution plan (future): single `http/generate` step, `affinity: session`, internal sub-pipeline (no Redis split between mint and spend).

## Dependencies (if re-implementing)

```json
{
  "dependencies": {
    "node-curl-impersonate": "^1.5.4",
    "playwright": "^1.49.1"
  },
  "devDependencies": {
    "tsx": "^4.19.2"
  }
}
```

Run: `chmod +x node_modules/node-curl-impersonate/bin/curl-impersonate-firefox-linux-x86`

## HAR / reference paths

- HAR: `~/Desktop/temp_tests/chatgpt.com_Archive [26-08-27 20-10-06].har`
- Extracted JS: `client-shared-8ZNw4zBQ.js`, `turnstile-CIoVD9UN.js` (hashes stale; discover live)

## Next steps when resuming

1. Re-test Playwright full-send baseline (`runChatgptGuestTurn`) — preferred path per DESIGN.md.
2. If pursuing efficiency: design warm **full-send** browser pool per proxy in `worker-browser` (not HTTP guest split).
3. Only resume HTTP guest if updates upstream 400 is fixed (fresh HAR + diff finalize/updates bodies).
4. If HTTP guest resumes: warm mint pool per proxy (~100ms evaluate) is viable for mint step only; cold mint is simpler for low traffic.
