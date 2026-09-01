# `apps/worker-browser` — Playwright Firefox runtime

This process **only** runs steps tagged `worker: "browser"`. Today that is ChatGPT’s full guest turn in **headless Firefox**.

It is the expensive pool: ~1GB RSS per Firefox, small concurrency, separate Docker image (`mcr.microsoft.com/playwright` + Firefox). Gemini is never scheduled here.

## Why Firefox, not Chromium

Locked in DESIGN.md after measurement:

| Path | Result |
|---|---|
| Pure HTTP (cookies, no JS mint) | Verification gate — not a v1 path |
| Headless Chromium | Cloudflare challenge / 403 |
| Headed Chromium | Guest turn worked |
| **Headless Firefox (Playwright) full-send** | Worked (~4.8s mean in the 2026-08-28 bench) |

Hybrid (browser mint + HTTP spend) also worked but was **slower** and used the **same RAM** because mint still launches Firefox. v1 is one `browser/generate` step. Hybrid remains a plan *shape* for a later target, not ChatGPT v1.

## Composition

Mirrors `worker-http` on purpose (same loop, same failure isolation):

- Registry: `buildStepRegistry([chatgptBrowserStepMeta], 'browser')`
- Dequeue: `jobQueue.dequeue('browser')` → queue `llm-queue-browser`
- Egress: lease URL passed into Playwright `proxy` (or omitted for `direct` / localhost)
- Completion: `orchestrator.processJob`

`src/worker.ts` is structurally the same as the HTTP worker so operational behavior (cleanup on crash, missing record) stays consistent across fleets.

## Concurrency

Browser capacity is the scarce resource. DESIGN.md: wait on the queue until the global deadline, then `TARGET_UNAVAILABLE` — do not silently run ChatGPT on an HTTP pod.

Follow-ups may pass `chatgpt_url` in job artifacts so Firefox opens the existing conversation instead of a cold `chatgpt.com` homepage.

## Run

```bash
npx playwright install firefox
export REDIS_URL=redis://localhost:6379
export DATABASE_URL=postgres://llm:llm@localhost:5432/llm_query
npx tsx apps/worker-browser/src/main.ts
```

Docker: compose `worker-browser`, Dockerfile target `worker-browser` (Playwright base image).

## Tests

`src/worker.spec.ts` — same pattern as HTTP: inject a fake `run` so CI does not need a live ChatGPT.

Live: `packages/adapters-chatgpt/src/playwright-guest.live.spec.ts` with `LIVE_INTEGRATION=1`.

## Related

- [packages/adapters-chatgpt](../../packages/adapters-chatgpt/README.md)
- [packages/adapters-chatgpt/CHATGPT_HTTP_GUEST_POC.md](../../packages/adapters-chatgpt/CHATGPT_HTTP_GUEST_POC.md) — research that is **not** shipped in this worker
