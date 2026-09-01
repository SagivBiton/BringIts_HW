# `apps/api` — stateless query gateway

The API is a **NestJS** process whose only job is to accept work and report status. It does not fetch Gemini, does not launch Playwright, and does not hold the HTTP client for the LLM turn.

That split is the product API: **POST 202 + poll GET**. Browser jobs and typical gateway idle timeouts (30–60s) cannot share a waiting POST.

## Public surface

| Method | Path | Result |
|---|---|---|
| `POST` | `/v1/queries` | **202** `{ request_id, status: "queued" }` |
| `GET` | `/v1/queries/:id` | In-flight: `{ request_id, status }`. Terminal: success body or typed error. Missing: **404**. |

Controller: `src/queries/queries.controller.ts`. Service: `src/queries/queries.service.ts`. Module wiring: `src/app.module.ts`.

### POST

1. Body is validated with `validateQueryCommand` from `@llm-query/types` (not ad-hoc checks in the controller).
2. `Orchestrator.submit` mints conversation + query records, leases a proxy, enqueues the adapter’s step(s).
3. `OrchestratorError` is mapped to HTTP:
   - `GEO_UNAVAILABLE` → **422**
   - `CONVERSATION_NOT_FOUND` → **404**
   - other orchestrator errors → **400**
4. Validation failures are **400** with `INVALID_REQUEST` / `UNSUPPORTED_SOURCE`.

The 202 body is intentionally tiny. The interesting payload is on GET after workers finish.

### GET

- `ok` → return `record.result` (normalized success contract).
- `error` → `{ request_id, status, duration_ms, source, prompt, error }`.
- `queued` / `running` → status only (no fake empty answer).

## Wiring (composition root)

`AppModule` is the composition root. It does not put Redis/Postgres *inside* Nest controllers; it **injects interfaces**:

| Token | Factory | Role |
|---|---|---|
| `QUERY_STORE` | `createQueryStore(REDIS_URL)` | Poll payload, TTL |
| `JOB_QUEUE` | `createJobQueue(REDIS_URL)` | BullMQ vs in-memory |
| `PROXY_POOL` | `createProxyPool(DATABASE_URL)` | Postgres vs in-memory |
| `CONVERSATION_STORE` | `InMemoryConversationStore` | Multi-turn + adapter `target_session` |
| `Orchestrator` | constructed from the above | Submit + (workers also use processJob) |

Same factories as the workers: if `REDIS_URL` / `DATABASE_URL` are unset, you get in-memory backends. That is how unit tests run without Docker. Multi-process local/prod **must** set the URLs or the API and workers will not share queues.

**Auth seam:** there is no inbound auth in v1. The controller is the place a later API-key middleware can reject `401` without touching adapters.

## What this app deliberately does not do

- No `if (source === 'chatgpt')` for execution.
- No step implementations.
- No proxy URL parsing.
- No streaming the target response to the caller (poll the result record).

## How to run

```bash
export REDIS_URL=redis://localhost:6379
export DATABASE_URL=postgres://llm:llm@localhost:5432/llm_query
npx tsx apps/api/src/main.ts
```

Listens on `PORT` or `3000`. Docker image target: `api` in the root `Dockerfile`.

## Tests

`src/queries/queries.controller.spec.ts` — HTTP mapping and validation behavior through Nest.

## Related

- [packages/types](../../packages/types/README.md) — request/result/error shapes
- [packages/orchestrator](../../packages/orchestrator/README.md) — submit lifecycle
- [DESIGN.md](../../DESIGN.md) §6 — locked public API
