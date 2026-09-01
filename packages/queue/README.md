# `@llm-query/queue` — ephemeral jobs, results, conversations

Redis is **ephemeral**: BullMQ queues, query poll records (~15 min TTL). Durable proxy state does **not** live here.

The package exposes **interfaces** plus in-memory and Redis implementations so the API, workers, and Jest share one contract.

## Three stores

### `QueryStore`

Poll document for `GET /v1/queries/:id`.

- `create` → `queued` record with `q_…` id
- `setStatus` → `running`
- `completeSuccess` / `completeError` — terminal payload
- Redis: `RedisQueryStore` (`query:{id}`, TTL aligned with `QUERY_TTL_MS`)
- Tests / no Redis: `InMemoryQueryStore`

Past TTL, the API can surface `expired` (DESIGN.md). Unknown id is 404.

### `JobQueue`

Two logical queues so HTTP and browser fleets never steal each other’s work:

| Worker | Redis name |
|---|---|
| `http` | `llm-queue-http` |
| `browser` | `llm-queue-browser` |

`enqueue(JobPayload)` routes on `job.worker`. `dequeue(worker)` is how the thin runtimes pull work.

`BullMQJobQueue` vs `InMemoryJobQueue`. `createJobQueue(REDIS_URL)` selects. Job id `${request_id}-${step_id}` keeps a step unique.

### `ConversationStore`

Multi-turn: turn list + adapter `target_session` (Gemini `c_`/`r_`, ChatGPT URL). Same TTL order as queries. Source is stored so a chatgpt id cannot be reused on gemini (`CONVERSATION_NOT_FOUND`).

- Redis: `RedisConversationStore` (`conversation:{id}`) via `createConversationStore(REDIS_URL)`
- Tests / no Redis: `InMemoryConversationStore` (**per process** — follow-ups across API + workers will not work)

Workers call `appendTurn` after a successful parse. The next `submit` on the API must load that record. Job artifacts still copy `effective_prompt` and `target_session` at enqueue so the worker has what it needs for **this** turn; Redis is what makes the **next** turn possible.

## Factories

`createQueryStore` / `createConversationStore` / `createJobQueue` / `createStores`: Redis when URL present, otherwise memory. One env var (`REDIS_URL`) switches the whole control plane from “laptop unit test” to “API and workers share state,” including conversations.

## Tests

- Contract-style specs for job queue and query store
- Redis specs skip or no-op when Redis is down
- `conversation-store.spec.ts` — TTL, source, append
- `redis-conversation-store.spec.ts` — skipped when Redis is down

## Related

- [apps/api](../../apps/api/README.md)
- [worker-http](../../apps/worker-http/README.md) / [worker-browser](../../apps/worker-browser/README.md)
- [DESIGN.md](../../DESIGN.md) §1.1 Redis
