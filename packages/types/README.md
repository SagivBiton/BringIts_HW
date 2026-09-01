# `@llm-query/types` — shared contracts (leaf package)

This package is the **schema of the system**. It has no Nest, no Redis, no Playwright. Everything else depends on it; it depends on almost nothing.

That is a dependency-graph choice, not a folder preference.

## Why a leaf package

Three consumers need the same types:

| Consumer | Uses |
|---|---|
| Adapters | **Build** `ExecutionPlan` from `QueryCommand` |
| Orchestrator | **Run** the plan (lease, enqueue, `ErrorDecision`) |
| Workers | Receive one `Step` as `JobPayload` |

If `ExecutionPlan` lived inside `@llm-query/orchestrator`, Gemini/ChatGPT would import the orchestrator while the orchestrator **registers** those adapters → **circular dependency**. A leaf `types` package breaks the cycle. The **runner** stays in the orchestrator; the **contract** stays here.

## What lives here

### Command and result

- `QueryCommand` — `source`, `prompt`, `parse`, optional `geo_location`, `conversation_id`
- `QueryRecord` / `QuerySuccessBody` / `PublicErrorBody` — poll payload
- `SubmitQueryResponse` — 202 body
- Limits: `MAX_PROMPT_LENGTH` (8192), `DEFAULT_PARSE`, `QUERY_TTL_MS` (15 min), `GLOBAL_DEADLINE_MS` (120s), `MAX_INTERNAL_RETRIES` (2)

### Execution

- `WorkerKind` — `'http' | 'browser'`
- `Step` — `id`, `worker`, `purpose` (`generate` | `mint` | `other`), `timeout_ms`, `uses_session`
- `ExecutionPlan` — `affinity`, optional `session_key`, `steps[]`
- `ProxyAffinity` — `'none' | 'request' | 'session'`
- `JobPayload` — what Redis carries: `request_id`, `step_id`, `source`, `worker`, `lease_id`, `timeout_ms`, `artifacts`

v1 adapters emit **one** step. The type still allows many so a future hybrid target (`browser/mint` then `http/generate`) does not rewrite the core.

### Errors (internal vs public)

- `ErrorCode` + `ERROR_HTTP_STATUS` — public enum
- `ErrorDecision` — internal: `retry`, `proxy_action`, `fingerprint` (logs/tests, **not** returned to callers)
- `RetryPolicy` — `never` | `same_lease` | `new_proxy` | `restart_plan`
- `ProxyAction` — `none` | `neutral` | `cooldown` | `burn` | `success_signal`

Callers see `PublicError` (`code`, `message`, `http_status`, `retryable`, `retry_after_ms`). They never see `fingerprint`, lease ids, or proxy URLs.

### Conversations

- `ConversationRecord` / `ConversationTurn`
- `buildPromptWithHistory` — for targets without a native continue API, history is folded into one prompt
- `createRequestId` / `createConversationId` — `q_` / `conv_` prefixes

### Validation

`validateQueryCommand` is the **single** gate for POST bodies: supported sources, prompt length, ISO 3166-1 alpha-2 geo, optional conversation id. The API service calls this; adapters assume a valid command.

## Design notes

- **Locale is not a request field.** Always `en-US` at plan time (orchestrator passes it in context).
- **`parse: false`** still requires `response_text` (minimum contract) plus a structured `payload` of recognized fields — not raw wire bytes.
- **`SUPPORTED_SOURCES`** is the registry key list. Unknown source is `UNSUPPORTED_SOURCE`, not a 500.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Types + re-exports |
| `src/errors.ts` | Codes and HTTP mapping |
| `src/validation.ts` | POST validation |
| `src/conversation.ts` | History prompt builder |
| `src/ids.ts` | Id minting |

## Related

- [orchestrator](../orchestrator/README.md)
- [DESIGN.md](../../DESIGN.md) §8
