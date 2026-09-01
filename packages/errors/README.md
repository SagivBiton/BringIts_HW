# `@llm-query/errors` — core transport classifier

Adapters fingerprint **site-specific** failures (challenge copy, missing Gemini bootstrap ids). This package classifies **transport and policy** signals the orchestrator already understands without opening HTML.

The orchestrator must not ad-hoc `if (status === 403)`. Every failure becomes an `ErrorDecision`: public code, retry hint, proxy action, fingerprint.

## `classifyTransportFailure`

Input is a `TransportSignal` union:

| `kind` | Typical mapping |
|---|---|
| `no_proxy` | Explicit geo → `GEO_UNAVAILABLE` (422). Default pool empty → `TARGET_UNAVAILABLE` (503). Retry `never`, proxy `none`. |
| `http_status` 429 | `TARGET_RATE_LIMITED`, `cooldown`, `new_proxy` if `affinity: none` else `same_lease` |
| `http_status` 403 | `TARGET_BLOCKED`, `new_proxy`, `cooldown` |
| other HTTP | `TARGET_UNAVAILABLE`, `neutral` |
| `timeout` | `TARGET_TIMEOUT`, `same_lease`, `neutral` (timeouts are weak burn signals) |
| `queue_saturated` | `TARGET_UNAVAILABLE` — worker did not accept before deadline |
| `empty_response` | `EMPTY_RESPONSE`, `same_lease`, `neutral` |
| `parse_failed` | `PARSING_FAILED`, `never`, `neutral` |

`retryable` on the decision is **for the caller** (should they POST again). After the system has already rotated IPs and exhausted budget, the user-facing flag should be false even if the *class* was “retry with a new IP.” That distinction is documented in DESIGN.md §6 / §10.

## Who classifies what

```
Transport / policy  →  @llm-query/errors
Site fingerprints    →  adapter.classify(raw)
                       →  ErrorDecision
                       →  proxy health + user GET body
```

**Core:** DNS/TLS/timeouts (as signals), 429/503, empty body, queue deadline, no healthy proxy.

**Adapter:** 200-with-challenge, Cloudflare interstitial, ChatGPT verification-gate copy, Gemini empty stream.

Classification **always** runs before parse (orchestrator). A block page is never an answer.

## Files

`src/classifier.ts` — the switch. `src/classifier.spec.ts` — table-style expectations for geo vs default pool, 429 vs 403, empty vs parse.

## Related

- [types](../types/README.md) — `ErrorDecision` shape
- [adapters-gemini](../adapters-gemini/README.md) / [adapters-chatgpt](../adapters-chatgpt/README.md)
- [DESIGN.md](../../DESIGN.md) §10
