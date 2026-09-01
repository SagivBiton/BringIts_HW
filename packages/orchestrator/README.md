# `@llm-query/orchestrator` — plan runner

The orchestrator is the **control plane** for one query. It does not know Gemini bootstrap selectors or ChatGPT CSS. It:

1. Resolves an adapter by `source` (map, not `if` on I/O)
2. Loads or creates a **conversation**
3. Asks `adapter.plan()` for an `ExecutionPlan`
4. **Acquires a proxy lease** (fail closed: `GEO_UNAVAILABLE` vs `TARGET_UNAVAILABLE`)
5. Writes a query record and **enqueues each step** with artifacts (effective prompt, session blobs)
6. After a worker runs a step: **classify → parse → complete**, then **release** the lease with a `ProxyAction`

Workers call `processJob` with capture artifacts. The API only calls `submit`. Same class, two roles.

## Adapter contract (what the orchestrator believes)

Each registered adapter:

```
id
plan(QueryCommand, PlanContext) → ExecutionPlan
parse(raw, { parse }) → { response_text, payload?, target_session? }
classify(raw) → ErrorDecision
resolvePrompt(QueryCommand, priorTurns) → string
```

Registry in the constructor: `gemini` and `chatgpt` packages. Adding a source is a map entry plus worker registry — still no site URLs here.

`PlanContext` includes `locale: 'en-US'`, `continuing`, `priorTurns`. Follow-ups set plan `affinity: 'session'` in the adapters.

## `submit`

1. If `conversation_id` is set: load it; missing or **source mismatch** → `CONVERSATION_NOT_FOUND`.
2. Else `conversations.create(source)` and use the new id (success bodies always have a conversation id for the next POST).
3. `plan()` then `proxyPool.acquire({ target, geo, affinity: plan.affinity })`.
4. No lease → `classifyTransportFailure({ kind: 'no_proxy', explicit_geo })` so omitted geo vs explicit geo produce **different public codes**. Stateless plans use the pool’s concurrent cap (default 1); `session`/`request` force exclusive egress.
5. `queryStore.create`, `resolvePrompt` (history-aware), enqueue one `JobPayload` per step with `lease_id` and artifacts (`conversation_id`, `effective_prompt`, `prior_turns`, plus `target_session` from the prior turn).

The API returns 202 as soon as this succeeds. Execution is the worker’s job.

## `processJob`

1. Mark `running`.
2. Run `stepRunner` if injected (tests), else use `precomputedArtifacts` from the worker.
3. `toRawCapture` maps artifacts to adapter-specific shapes (`streamBody` vs `htmlPartial` / `pageUrl`). This is a thin boundary so adapters stay typed without the orchestrator importing Playwright.
4. **`classify` first.** If the decision is a terminal failure class (`TARGET_BLOCKED`, empty, parse fail, rate limit, timeout), complete **error**, release with `proxy_action`, **do not parse**.
5. `parse`. Empty `response_text` → transport `empty_response` (same rule: never invent an answer).
6. Append user + assistant turns and merge `target_session` (Gemini conversation ids, ChatGPT URL).
7. Release lease `success_signal`, `completeSuccess`.
8. Unexpected throw → lease `neutral`, `INTERNAL_ERROR`.

`processNextJob` is a test helper: dequeue + `processJob` in-process (no separate worker).

## Design choices

- **Classify before parse** — a 200 “verify you are human” page must not become `response_text`.
- **Lease always released** on success, classified failure, and catch — proxies are scarce.
- **Safe errors** — public body is the `ErrorDecision` fields callers are allowed to see; fingerprints stay internal.
- **Conversation TTL** matches query TTL (~15 min): guest sessions are ephemeral by product choice.

## Tests

`src/orchestrator.spec.ts` — submit validation paths, conversation mismatch, lease miss, classify/parse completion with a fake `stepRunner`.

## Related

- [types](../types/README.md)
- [errors](../errors/README.md)
- [proxy](../proxy/README.md)
- [queue](../queue/README.md)
- [DESIGN.md](../../DESIGN.md) §9
