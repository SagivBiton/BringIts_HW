# LLM Web Query Service

A production-shaped **async NestJS service** that runs a prompt against **consumer LLM websites** (`gemini.google.com`, `chatgpt.com`) as a **guest** — no official APIs, no target logins, no imported personal cookies.

Callers submit a query, get **HTTP 202**, and poll until a **normalized** answer (or a **typed error**) is ready. Gemini is executed as cheap HTTP. ChatGPT is executed as headless **Firefox** (Playwright). Those two paths never share a worker image, a queue, or a scale knob.

This is not a scraper glued to a REST controller. The system is split so that **site quirks stay in adapters**, **egress is a leased resource**, and **HTTP vs browser capacity scales independently**.

| | |
|---|---|
| **Public contract** | `POST /v1/queries` → 202 `{ request_id, status: "queued" }` · `GET /v1/queries/:id` until `ok` / `error` / `expired` |
| **Sources** | `gemini` (HTTP) · `chatgpt` (Playwright Firefox) |
| **Stores** | Redis (queues + query TTL + **conversations**) · Postgres (proxy inventory, health, leases) |
| **Invariant** | Guest-only, permanently. A block/challenge page is never reported as an LLM answer. |

---

## Why this architecture

Consumer sites are slow, flaky, geo-sensitive, and sometimes JS-gated. A waiting POST on the API would fight gateway idle timeouts (30–60s) as soon as ChatGPT is in the mix. So the API is **stateless enqueue + poll**: it never holds a browser, never talks to Gemini, and never owns a proxy URL.

Three capacities are independent on purpose:

| You need more… | You add… | You do **not**… |
|---|---|---|
| Gemini QPS | `worker-http` replicas | Launch Firefox |
| ChatGPT QPS | `worker-browser` replicas | Put Gemini on a browser pod |
| Geos / IPs | Postgres `proxies` rows | Hard-code egress in adapters |
| API clients | API replicas | Touch workers |

Adapters declare an **`ExecutionPlan`** (`http` vs `browser` steps, timeouts, proxy affinity). The orchestrator **runs** the plan. Workers are **thin runtimes** that load only the steps they are allowed to import. Adding a later LLM is a new adapter package plus a registry line — not an `if (source === …)` in the core. How that stays true as sites and features land is spelled out in [Maintainability](#maintainability-new-sites-and-features).

The planning document with locked decisions is [DESIGN.md](./DESIGN.md). Per-package READMEs walk the code.

---

## Documentation map

Start here, then go deeper:

| Document | What you learn |
|---|---|
| [docs/README.md](./docs/README.md) | How the docs are organized |
| [DESIGN.md](./DESIGN.md) | Locked architecture, constraints, error policy, decision log |
| [apps/api](./apps/api/README.md) | NestJS 202/poll surface, validation, wiring |
| [apps/worker-http](./apps/worker-http/README.md) | Gemini runtime (no Playwright) |
| [apps/worker-browser](./apps/worker-browser/README.md) | ChatGPT runtime (Firefox only) |
| [packages/types](./packages/types/README.md) | Shared contracts (`QueryCommand`, `ExecutionPlan`, `ErrorDecision`) |
| [packages/orchestrator](./packages/orchestrator/README.md) | Plan → lease → enqueue → classify → parse |
| [packages/errors](./packages/errors/README.md) | Transport classifier vs adapter fingerprints |
| [packages/proxy](./packages/proxy/README.md) | Static pool, leases, per-(proxy, target) health |
| [packages/queue](./packages/queue/README.md) | Redis/BullMQ + query, job, **and conversation** stores |
| [packages/worker-runtime](./packages/worker-runtime/README.md) | Explicit step registry (no filesystem walk) |
| [packages/adapters-gemini](./packages/adapters-gemini/README.md) | Guest HTTP generate + StreamGenerate parse |
| [packages/adapters-chatgpt](./packages/adapters-chatgpt/README.md) | Guest Firefox full-send + HTML parse |

---

## System at a glance

```mermaid
flowchart LR
  client[Client]
  api[API]
  redis[Redis]
  pg[Postgres]
  httpW[worker-http]
  browserW[worker-browser]
  gemini[gemini.google.com]
  chatgpt[chatgpt.com]

  client -->|"POST 202 / GET poll"| api
  api --> redis
  api --> pg
  redis --> httpW
  redis --> browserW
  httpW --> pg
  browserW --> pg
  httpW --> gemini
  browserW --> chatgpt
```

**Request path (one query):**

1. API validates the body (`packages/types`), then `Orchestrator.submit`.
2. Adapter `plan()` returns one step today (`http/generate` or `browser/generate`). The type still allows multi-step / hybrid later.
3. A **proxy lease** is acquired from Postgres (or the in-memory pool in tests). Explicit `geo_location` with no healthy proxy → `GEO_UNAVAILABLE` (422). No silent country substitution.
4. The job is pushed to `llm-queue-http` or `llm-queue-browser`.
5. The matching worker runs the **adapter-owned step** through the leased egress, then calls `Orchestrator.processJob`.
6. **Classify before parse.** Challenge HTML is `TARGET_BLOCKED`, never `response_text`.
7. Success writes `ok` to Redis (~15 min TTL) and appends conversation turns in a **shared** `ConversationStore` (Redis when `REDIS_URL` is set). Client polls GET. Follow-ups only work if API and workers share that store — in-memory conversations are per-process and cannot continue a chat across the three apps.

---

## Design choices worth noticing

These are the decisions the rest of the repo is built around. Details live in the package READMEs and [DESIGN.md](./DESIGN.md).

1. **Adapters own sites; the core owns jobs, proxies, errors, and the public schema.** Gemini URLs do not live in the HTTP worker. Playwright does not live in the API. The orchestrator has no `if (source === 'gemini')` for I/O.

2. **`ExecutionPlan` lives in `packages/types`, not in the orchestrator.** Adapters *build* plans, the orchestrator *runs* them, workers receive a `Step` as a job. Putting the type in the orchestrator package would force adapters to import the orchestrator while the orchestrator registers adapters — a circular dependency.

3. **Workers are runtimes, not site bots.** Each adapter exports steps tagged `worker: "http" | "browser"`. `worker-http` imports only HTTP steps; `worker-browser` imports only browser steps. That keeps Docker graphs honest: the HTTP image must not pull Playwright.

4. **ChatGPT is headless Firefox, not Chromium and not hybrid (v1).** Research showed pure HTTP failing the verification gate, headless Chromium challenged, and Firefox full-send working. Hybrid mint+HTTP spend is kept as a *plan shape* for a future target, not ChatGPT v1 (browser start dominates cost anyway).

5. **Proxies are perishable inventory in Postgres, not an env URL.** Health is keyed by `(proxy_id, target)` so a ChatGPT burn does not retire a Gemini IP. Burns survive a Redis flush. Test/dev uses a `kind = local-test` row (`direct`), not a code path that skips the pool. Each proxy tracks **active lease count** with a configurable cap (`PROXY_MAX_CONCURRENT_LEASES`, default **1**); sticky plans (`session` / `request`) stay exclusive.

6. **Errors are `ErrorDecision`s, not status-code `if`s.** Transport vs adapter classification, retry policy, proxy action (`cooldown` / `burn` / `success_signal`), and a **public** code for the caller are one object. Internal IP rotation is not advertised as `retryable: true` after budget is exhausted.

7. **Async API from day one.** Style B (202 + poll) was chosen over sync POST-and-wait. Webhooks can sit on the same result record later.

8. **Guest-only is product scope**, not a capability flag. If a later site cannot be used as a guest, that source is out of product — we do not add login.

9. **Conversations are Redis when the stack is multi-process.** `createConversationStore(REDIS_URL)` is the same factory pattern as query store and job queue. Workers `appendTurn` after parse; the next `POST` on the API must see that history and `target_session` (Gemini `c_`/`r_`, ChatGPT URL). Without Redis, each process has its own empty memory map and follow-ups 404 or start a new chat.

---

## Maintainability: new sites and features

The repo is built so a **new consumer website** or a **new capability** (extra generate step, hybrid mint+HTTP, another poll field) does not rewrite the API, queues, or proxy pool.

### New website (new `source`)

Site-specific knowledge is confined to **one adapter package**. Core packages stay site-agnostic.

| Piece | Where it lives | What you add |
|---|---|---|
| Public `source` string | `packages/types` validation | One allowed id |
| Plan + parse + classify + prompt | `packages/adapters-<name>` | New package implementing the adapter contract |
| How the worker runs I/O | Same package, `steps/*.ts` + `*StepMeta` | Tag `worker: "http"` and/or `"browser"` |
| HTTP fleet import | `apps/worker-http` | Register the HTTP meta only |
| Browser fleet import | `apps/worker-browser` | Register the browser meta only |
| Orchestrator lookup | `Orchestrator` constructor map | One `source → adapter` entry |

You do **not** add: Gemini/ChatGPT URLs in workers, Playwright in the API, or `if (source === '…')` around fetch/DOM.

The adapter contract the core already understands:

```
plan(QueryCommand, PlanContext) → ExecutionPlan
parse(raw, { parse }) → { response_text, payload?, target_session? }
classify(raw) → ErrorDecision
resolvePrompt(QueryCommand, priorTurns) → string
```

`ExecutionPlan` can already describe **multiple steps** and mixed `http`/`browser` workers. A later site that needs “mint in Firefox, spend over HTTP” is extra metas in **that** adapter; both fleets already dequeue by `job.worker` and look up `` `${source}:${step_id}` `` in an **explicit** registry (no filesystem glob).

Session for follow-ups is **opaque `target_session`**. Gemini stores `c_`/`r_`; ChatGPT stores `chatgpt_url`. A new site adds its own keys; callers still only pass `conversation_id`.

### New features (without a new site)

| Feature | Extension point |
|---|---|
| Extra generate / bootstrap step | New `Step` on the existing adapter’s plan + a new `*StepMeta` on the matching worker |
| Stricter parse / UI chrome | Adapter `parse` / wait loop only (ChatGPT intermediate “Searching the web”, CSS leak strip, Gemini `card_content` URLs) |
| New public error | `ErrorDecision` + classifier; API already returns typed codes |
| Webhooks | Same Redis query record the poller already reads |
| More geos / IPs | Postgres `proxies` rows — adapters never hard-code egress |
| Independent QPS | Replica the HTTP or browser worker only |
| Higher throughput per IP (stateless only) | Raise `PROXY_MAX_CONCURRENT_LEASES` — see [proxy concurrency](./packages/proxy/README.md#concurrent-leases-per-proxy) |

Workers stay **runtimes**: they import only the steps their image is allowed to run. That keeps Docker graphs honest when a third site is HTTP-only or browser-only.

### Scaling proxy inventory vs workers

Workers and proxies are **separate knobs**. Peak concurrent jobs ≈ **QPS × hold time** (how long a lease is held). With default **1 lease per proxy**, you need roughly that many free IPs at peak. The pool already supports **N concurrent leases per proxy** for `affinity: none` (stateless Gemini-style jobs); v1 leaves **N=1** so health signals stay clean until you deliberately raise it.

| Knob | What it buys | Tradeoff if mis-tuned |
|---|---|---|
| More worker replicas | Faster dequeue / more parallel scrapes | Useless if every proxy is at its lease cap |
| More proxy rows | More concurrent egress / geos | Cost; still need health discipline |
| `PROXY_MAX_CONCURRENT_LEASES` > 1 | Fewer IPs for the same concurrent load | More 429/blocks, noisier `(proxy, target)` health; **never** for `session`/`request` |

Raising concurrency is a **config change**, not a pool rewrite — maintainability for later scale.

---

## Scraping approach

The assignment asks how each target was investigated, not only which library we shipped. Both sources were treated as **unfamiliar consumer sites**: HAR / live traffic first, then a runtime that matches what actually worked. Official OpenAI / Gemini APIs and third-party “LLM scraper” products are not used.

### Gemini — direct HTTP (Option B)

**What we discovered.** Guest generate works **without a browser** from a research IP.

1. `GET https://gemini.google.com/app` (HTML). Read bootstrap ids `FdrFJe` (`f.sid`) and `cfb2h` (`bl`) from the page.
2. `POST https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate` with `f.req` wrapping the prompt, `hl=en-US`, Origin/Referer/`X-Same-Domain`. Dummy attestation strings were enough in that test; **cookies were not required on the POST**.
3. Body is a streamed nested JSON-ish blob. Assistant prose sits in `rc_…` arrays. Protocol tokens (`c_`, `r_`, `wrb.`, UI chrome) must be filtered. Conversation ids (`c_…` / `r_…`) appear in the same stream and are stored as `target_session` for follow-ups.

**Browser vs HTTP.** HTTP is the v1 path. A later BotGuard/WAA requirement would be a new **step file in the same adapter**, not a login and not a rewrite of the system.

**Parsing.** Prefer `rc_` answers over “longest quoted string.” `parse: false` returns a structured `payload` (recognized fields + leftover stream), not raw wire bytes. Citations / stable markdown were **not** a reliable schema in research; we omit them rather than invent them.

**Blocking.** Empty stream, captcha / “verify you are human” → classified as `EMPTY_RESPONSE` / `TARGET_BLOCKED` **before** parse. Gemini Set-Cookie headers can exceed undici’s default 16KiB cap; fetch uses a raised `maxHeaderSize`.

Code: [packages/adapters-gemini/README.md](./packages/adapters-gemini/README.md).

### ChatGPT — headless Firefox full-send (Option A for v1)

**What we discovered.** The guest UI is JS-gated (Sentinel / Turnstile / Cloudflare). The unauth composer is not a stable `#prompt-textarea`; we wait on several selectors. Assistant HTML often includes **intermediate** status (“Searching the web”, “Thinking”) and leaked guest-shell CSS; we wait until markdown text is **stable** and drop intermediates so those are never `response_text`.

**Network (researched, not the v1 runtime).** Unauth mweb (HAR): `GET chatgpt.com` → Sentinel `prepare` / Turnstile mint / `finalize` → conversation `prepare` + `updates`. Tokens are **one-shot** (no replay). `oai-session-id` can stay across follow-ups; proof/turnstile/conduit change every send. Plain `fetch` on the homepage often gets **403**; curl-impersonate Firefox TLS can fetch the shell. That HTTP path is documented in [CHATGPT_HTTP_GUEST_POC.md](./packages/adapters-chatgpt/CHATGPT_HTTP_GUEST_POC.md) and **not shipped** — mint still needed a browser, RAM stayed ~1GB, and full-send was slightly faster.

**Browser vs HTTP vs hybrid.**

| Attempt | Result |
|---|---|
| Pure HTTP (cookies, no JS mint) | Verification gate |
| Headless Chromium | Cloudflare / 403 |
| Headed Chromium full turn | Guest turn worked |
| Browser mint + HTTP spend once | Worked; replay failed (one-shot tokens) |
| **Headless Firefox full-send (v1)** | Worked (~4.8s mean, ~1GB RSS) |
| Firefox mint + HTTP spend | Worked, slower, same RAM |

**Session.** Follow-ups pass `conversation_id`. After a successful turn the worker merges `chatgpt_url` into Redis `target_session`; the next job reopens that URL in Firefox. Callers never send cookies. Guest composer ≠ logged-in app (no history sidebar, different DOM). Wait-for-answer prefers `[data-assistant-markdown]` once it exists, but first waits on **any** assistant node so a slow markdown mount does not time out on the wrong locator.

**Blocking.** Verification-gate copy and `cdn-cgi/challenge` → `TARGET_BLOCKED`, never parsed as an answer.

Code: [packages/adapters-chatgpt/README.md](./packages/adapters-chatgpt/README.md).

### Extra request field (beyond the assignment interface)

| Field | Why it exists |
|---|---|
| `conversation_id` | Assignment “when available, extract conversation identifiers.” Guest sites still support a second turn if we keep **server-side** session artifacts (Gemini `c_`/`r_`, ChatGPT URL) in Redis and an optional client token. Omit to start a chat; pass it to continue (same `source`). Not a login. API **and** workers must use `createConversationStore(REDIS_URL)` so `appendTurn` is visible on the next POST. |

Locale is always `en-US` (not derived from `geo_location`).

### Guest vs signed-in

We only use **signed-out** surfaces. We do not import personal cookies or passwords. Signed-in ChatGPT/Gemini would add account cookies, different conversation APIs, and ToS/credential handling — out of scope. Guest Gemini HTTP and guest ChatGPT Firefox are the paths we proved.

### Geo / proxies (limitation)

The code path is real: `geo_location` → lease a matching row from Postgres; none healthy → `GEO_UNAVAILABLE` (no silent country swap). **Local default inventory is `direct` (no HTTP proxy).** Residential geo routing needs you to insert proxy URLs into `proxies`. That is where selection fits (see [packages/proxy](./packages/proxy/README.md)).

---

## Challenges (investigation, including dead ends)

This is the investigation process, not only the code that remained.

**ChatGPT — I tried HTTP first.** The target is a SPA with Sentinel. I initially tried cookie-only HTTP. The target responded with a **verification gate**, not an assistant message. I discovered the unauth mweb endpoints (prepare / Turnstile / POW / conversation updates) and that tokens are one-shot. I changed the implementation to **not** treat that as v1.

**ChatGPT — I tried headless Chromium.** The target responded with **Cloudflare 403**. Headed Chromium worked. I discovered **headless Firefox** (Playwright) completes a guest turn. I changed the browser worker to Firefox-only; Chromium is not the ChatGPT runtime.

**ChatGPT — I tried hybrid mint + HTTP spend** to avoid a full SPA per job. It worked once per token set; replay failed. A bench (2026-08-28) showed hybrid **slower** than full-send with **the same Firefox RAM** (startup dominates). I kept hybrid as an `ExecutionPlan` shape for a later target and shipped **one `browser/generate` step**.

**ChatGPT — DOM drift.** `#prompt-textarea` disappeared on the guest shell; CSS leaked into “assistant” nodes; search status looked like an answer. Parser and wait-loop were rewritten (multi-selector composer, markdown preference, stability, `isIntermediateAssistantText`).

**Gemini — nested StreamGenerate.** A naive “pick the longest string” picked geo labels, model ids, and UI chrome. I discovered `rc_` arrays and protocol-token filters. Bootstrap ids are live per `GET /app`; missing ids are a failed capture, not an empty successful answer.

**Gemini — undici header size.** Large `Set-Cookie` on `/app` exceeded the default 16KiB header limit. Proxied fetch raises `maxHeaderSize`.

**Async API.** A waiting POST cannot survive ChatGPT + gateway idle timeouts. POST **202 + poll** was chosen over sync.

**If blocking appears at higher volume** (we still classify 403/429/challenge even when a research IP is clean): rotate leases (`new_proxy` + cooldown/burn per target), cap browser concurrency, inspect TLS/JA3 vs Firefox, re-validate Gemini bootstrap selectors, and only then consider a ChatGPT HTTP spend step once mint is reliable. Infinite retry is forbidden.

---

## Repository layout

npm workspaces (`packages/*`, `apps/*`). Shared TypeScript paths `@llm-query/*`.

```
apps/api/                 Stateless NestJS: validate, 202, GET poll
apps/worker-http/         HTTP runtime + Gemini generate step
apps/worker-browser/      Playwright Firefox runtime + ChatGPT generate step
packages/types/           Leaf contracts (breaks adapter ↔ orchestrator cycle)
packages/orchestrator/   Plan, lease, enqueue, classify, parse, complete
packages/errors/          Core transport classifier
packages/proxy/           ProxyPool: in-memory + Postgres
packages/queue/           QueryStore, JobQueue, ConversationStore
packages/worker-runtime/  Explicit step registry
packages/adapters-gemini/
packages/adapters-chatgpt/
docker-compose.yml        postgres, redis, optional app images
Dockerfile                multi-target: api | worker-http | worker-browser
```

---

## Requirements

- Node.js 20+ (22 recommended)
- npm
- Docker (Postgres + Redis)
- For ChatGPT: Playwright Firefox (`npx playwright install firefox`)

---

## Install

```bash
git clone <repo-url> && cd BringIts_HW
npm install
npx playwright install firefox   # ChatGPT worker / live tests only
```

---

## Run the system

### 1. Infrastructure

```bash
docker compose up -d postgres redis
```

| Service  | Connection |
|----------|------------|
| Postgres | `postgres://llm:llm@localhost:5432/llm_query` |
| Redis     | `redis://localhost:6379` |

Proxy inventory is seeded on first Postgres boot (`local` / `direct` / `local-test`). Check with `docker compose ps`.

### 2. Environment

In every terminal that runs the API or a worker:

```bash
export REDIS_URL=redis://localhost:6379
export DATABASE_URL=postgres://llm:llm@localhost:5432/llm_query
# optional: PORT=3000, PROXY_URL=direct
# optional: PROXY_MAX_CONCURRENT_LEASES=1   # default; raise for stateless scale (see packages/proxy README)
```

Without `REDIS_URL` / `DATABASE_URL`, apps fall back to **in-memory** stores (unit tests; not multi-process API + workers).

### 3. API + workers (three processes)

Prefer `tsx` against source in this monorepo:

```bash
npx tsx apps/api/src/main.ts              # :3000
npx tsx apps/worker-http/src/main.ts      # gemini
npx tsx apps/worker-browser/src/main.ts    # chatgpt (Firefox)
```

| `source`   | Worker |
|------------|--------|
| `gemini`   | `worker-http` |
| `chatgpt`  | `worker-browser` |

### 4. Full Docker stack

```bash
docker compose up --build
```

The ChatGPT worker image is Playwright-based and is larger/slower to build.

---

## How to use the API

Base URL: `http://localhost:3000`

### Submit

```bash
curl -s -X POST http://localhost:3000/v1/queries \
  -H 'content-type: application/json' \
  -d '{"source":"gemini","prompt":"Reply with exactly: pong"}'
```

**202**

```json
{ "request_id": "q_…", "status": "queued" }
```

### Poll

```bash
curl -s http://localhost:3000/v1/queries/q_YOUR_ID
```

Statuses: `queued` → `running` → `ok` | `error` | `expired`.

Success (`ok`) includes at least: `request_id`, `status`, `source`, `prompt`, `response_text`, `duration_ms`, and `conversation_id`.

### Request body

Assignment fields: `source`, `prompt`, `parse`, `geo_location`. One extra field is documented above (`conversation_id`).

| Field | Required | Notes |
|---|----------|--------|
| `source` | yes | `gemini` or `chatgpt` |
| `prompt` | yes | Non-empty string (max 8192) |
| `parse` | no | Default `true`. If `false`, also returns structured `payload` |
| `geo_location` | no | ISO alpha-2. No healthy proxy in that geo → `GEO_UNAVAILABLE` (422) |
| `conversation_id` | no | Extra: omit for a new chat; set to continue (same `source`) |

Locale is always **en-US** (not derived from geo).

### Follow-up turn

Requires `REDIS_URL` on the API **and** both workers (shared `RedisConversationStore`). Gemini folds prior turns into `effective_prompt` via `buildPromptWithHistory`. ChatGPT also reopens `chatgpt_url` from `target_session`.

```bash
curl -s -X POST http://localhost:3000/v1/queries \
  -H 'content-type: application/json' \
  -d '{"source":"gemini","prompt":"Name one country in Europe"}'
# save conversation_id from the ok body, then:
curl -s -X POST http://localhost:3000/v1/queries \
  -H 'content-type: application/json' \
  -d '{"source":"gemini","prompt":"And one in Asia?","conversation_id":"conv_…"}'
```

Live multi-turn smoke (different prompts each turn, both sources): `npx tsx scripts/e2e-followups.ts`.

### Errors (typed)

| Code | Meaning |
|------|---------|
| `INVALID_REQUEST` | Bad body |
| `UNSUPPORTED_SOURCE` | Unknown `source` |
| `GEO_UNAVAILABLE` | Explicit geo has no healthy proxy |
| `CONVERSATION_NOT_FOUND` | Bad / expired / mismatched `conversation_id` |
| `TARGET_BLOCKED` | Challenge / block page |
| `EMPTY_RESPONSE` | No assistant text |
| `TARGET_TIMEOUT` / `INTERNAL_ERROR` | Timeouts / unexpected failures |

Unknown `request_id` → **404**. Error bodies never include proxy identity, tokens, or challenge HTML.

---

## Tests

```bash
npm test
```

Live hits to real sites (opt-in):

```bash
LIVE_INTEGRATION=1 npm test -- packages/adapters-gemini/src/gemini.live.spec.ts
LIVE_INTEGRATION=1 npm test -- packages/adapters-chatgpt/src/playwright-guest.live.spec.ts
```

With the stack running (`REDIS_URL` + workers):

```bash
npx tsx scripts/e2e-full-prompts.ts    # single-turn Gemini + ChatGPT
npx tsx scripts/e2e-followups.ts       # 3-turn conversations, both sources
```

---

## Stop

```bash
# Ctrl+C app processes, then:
docker compose down          # keep DB volume
docker compose down -v      # wipe Postgres data
```

---

## Notes

- **Guest-only** toward Gemini/ChatGPT. No target logins.
- Local default proxy is `direct`. Insert real proxy rows in Postgres for production-style egress.
- Query results live in Redis with a ~15 minute TTL.
- Conversation session artifacts (Gemini `c_`/`r_` ids, ChatGPT conversation URL) stay on the server in Redis; callers only see `conversation_id`. In-memory conversation store is for unit tests, not a split API/worker deploy.
