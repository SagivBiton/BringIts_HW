# `apps/worker-http` — HTTP worker runtime

This process **only** runs steps tagged `worker: "http"`. Today that is Gemini’s `generate` step. It must not import Playwright or ChatGPT browser modules — the HTTP image stays small and replica-cheap.

Gemini never occupies a browser slot. Scaling Gemini QPS is “more of this process,” not more Firefox RAM.

## Composition

`src/main.ts` wires:

1. `createQueryStore` / `createJobQueue` (Redis when `REDIS_URL` is set)
2. `createProxyPool` (Postgres when `DATABASE_URL` is set)
3. `Orchestrator` (same class the API uses for `processJob`)
4. `buildStepRegistry([geminiHttpStepMeta], 'http')` — **explicit** registry, filtered to HTTP

Then a loop: `processOneHttpJob` every 500ms when idle.

**Hard rule (DESIGN.md):** worker composition is not a filesystem walk of `steps/`. Nest/webpack/Docker make that fragile. Adapters **export** step metadata; the app imports what this runtime is allowed to see.

## Job handling (`src/worker.ts`)

`processOneHttpJob`:

1. `jobQueue.dequeue('http')` — only the HTTP BullMQ queue (`llm-queue-http`).
2. Load the query record; if missing, release the lease `neutral` and stop (TTL / race).
3. Resolve egress URL from the **lease** (`getLeaseProxyUrl`), not from env as the source of truth.
4. Prompt is `job.artifacts.effective_prompt` when present (history-expanded follow-ups), else the stored prompt.
5. `runRegisteredStep` → Gemini HTTP generate (bootstrap + StreamGenerate).
6. `orchestrator.processJob(job, artifacts)` — classify, parse, write `ok`/`error`, release lease with a proxy action.

On unexpected throw: lease `neutral`, `INTERNAL_ERROR` on the query, **loop keeps running**. One bad job must not kill the replica.

## Why a separate app from `worker-browser`

| | HTTP worker | Browser worker |
|---|---|---|
| Queue | `llm-queue-http` | `llm-queue-browser` |
| Typical cost | fetch + parse | ~1GB Firefox RSS per turn |
| Image | Node slim | Playwright Firefox |
| Scale | wide | hard cap, few replicas |

A hybrid future adapter can still enqueue an `http` spend step here while a `browser` mint runs on the other fleet, sharing `lease_id` in the job payload. v1 Gemini is a **single** HTTP step; two jobs would be wasted Redis hops.

## Tests

- `src/worker.spec.ts` — dequeue + registry + orchestrator completion with injected step
- `src/async-pipeline.spec.ts` — optional Redis+BullMQ submit → dequeue → `ok` (skips if Redis down)

## Run

```bash
export REDIS_URL=redis://localhost:6379
export DATABASE_URL=postgres://llm:llm@localhost:5432/llm_query
npx tsx apps/worker-http/src/main.ts
```

Docker: compose service `worker-http`, Dockerfile target `worker-http`.

## Related

- [packages/adapters-gemini](../../packages/adapters-gemini/README.md)
- [packages/worker-runtime](../../packages/worker-runtime/README.md)
- [packages/orchestrator](../../packages/orchestrator/README.md)
