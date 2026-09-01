# `@llm-query/proxy` — egress as a leased resource

Production traffic is meant to leave through a **static proxy pool** you insert as rows — not “whatever IP the pod has,” and not a Redis hash that a flush would wipe (inventory + burns would vanish).

The pool is small and static. **Row-level leases** track who is using each IP. Health is **per `(proxy_id, target)`** so a ChatGPT challenge does not burn a Gemini-capable IP.

## Contract: `ProxyPool`

```
acquire(AcquireRequest) → ProxyLease | null
release(leaseId, ProxyAction)
applyHealthAction(proxyId, target, action)
getProxyUrl / getLeaseProxyUrl
```

`AcquireRequest`: `target` (gemini/chatgpt), optional `geo`, optional `request_id`, optional `affinity` (`none` | `session` | `request`).

Two implementations share this interface so tests and Docker use the **same** acquire/release/health rules:

| Implementation | When |
|---|---|
| `InMemoryProxyPool` | No `DATABASE_URL`; unit tests |
| `PostgresProxyPool` | `DATABASE_URL` set |

`createProxyPool` in `src/factories.ts` chooses. Postgres connect uses `withRetry` because Docker DNS can flap (`EAI_AGAIN`) right after `depends_on: healthy`.

## Concurrent leases per proxy

Each proxy can hold **multiple active leases** up to a cap. The cap is resolved by `resolveMaxConcurrentLeases()` in `src/concurrency.ts`.

| Setting | Value | When it applies |
|---|---|---|
| `DEFAULT_MAX_CONCURRENT_LEASES_PER_PROXY` | **1** | Stateless jobs (`affinity: none` or omitted) — **v1 default** |
| `STICKY_MAX_CONCURRENT_LEASES` | **1** | `affinity: session` or `request` — always exclusive |
| `PROXY_MAX_CONCURRENT_LEASES` (env) | optional | Overrides default for stateless acquires in production |
| `ProxyPoolOptions.maxConcurrentPerProxy` | optional | Tests or explicit factory wiring |

**v1 behavior is unchanged:** default cap is **1**, so one job per IP at a time unless you raise the env var.

### How acquire uses the cap

1. Count unexpired rows in `proxy_leases` for each proxy (Postgres subquery; in-memory scan).
2. Admit only if `active_leases < maxConcurrent` for this request’s affinity.
3. Prefer proxies with **fewer** active leases, then higher health **score** (spread load instead of stacking N jobs on the “best” IP).

Each job still gets its own `lease_id`; workers resolve egress via that lease. Health updates remain per `(proxy_id, target)` on `release`.

### Tradeoff: why default 1, why allow N later

| N = 1 (default) | N > 1 (stateless only) |
|---|---|
| Clean health signals — one job owns the failure/success story on that IP | Higher concurrent throughput **per proxy dollar** |
| Lower risk of target-side 429 / challenge from burst traffic on one IP | Peak inventory need drops (~÷N for short holds) |
| Safe for session/sticky semantics | Shared IP → ambiguous burns, faster rate limits, weaker attribution |
| Matches conservative guest scraping | Best for short Gemini HTTP turns; still risky for ChatGPT |

**Sticky plans never share:** follow-ups (`affinity: session`) and future hybrid multi-step jobs (`affinity: request`) always use `STICKY_MAX_CONCURRENT_LEASES = 1` even if `PROXY_MAX_CONCURRENT_LEASES=5`.

### Maintainability / scaling without a rewrite

The old code treated “proxy busy” as a boolean (`proxyLeased` / `lease_id IS NULL`). The new model is **count-based** with a single resolver and the same `AcquireRequest` shape. To scale stateless traffic later:

1. Set `PROXY_MAX_CONCURRENT_LEASES=2` (or 3) after measuring 429/block rates on Gemini.
2. Add proxy rows for geos — no adapter changes.
3. Keep session follow-ups on exclusive leases automatically via `plan.affinity`.

Orchestrator already passes `plan.affinity` into `acquire`. Workers and job payloads are unchanged.

## Inventory (Postgres)

Migration: `migrations/001_proxies.sql` (also mounted into compose as init).

- **`proxies`** — `id`, `url`, `geo`, `kind` (`residential` \| `datacenter` \| … \| `local-test`), `mode` (`stateless` \| `stateful`), `enabled`
- **`proxy_health`** — `score`, `consecutive_failures`, `cooldown_until`, `burned_until`, PK `(proxy_id, target)`
- **`proxy_leases`** — `lease_id`, `proxy_id`, `request_id`, `target`, `expires_at` (many rows per `proxy_id` allowed)

Seed: `local` / `direct` / `kind = local-test`. Test egress is a **row**, not a bypass around the table.

## Selection and health

`acquire` picks an enabled proxy under the concurrent cap, matching geo when requested, not in cooldown/burn for **that target**. Order: lowest active lease count, then highest `score`.

On `release`:

| `ProxyAction` | Effect |
|---|---|
| `success_signal` | Score up (capped at 1), consecutive failures 0 |
| `cooldown` | Score down, failures++, `cooldown_until` +5 minutes |
| `burn` | Score 0, `burned_until` +1 hour |
| `neutral` / `none` | No health write |

Timeouts should map to `neutral` (classifier), not burn — a slow model is not a dead IP.

**No silent geo fallback:** `geo=DE` with no healthy DE proxy returns `null`; the orchestrator turns that into `GEO_UNAVAILABLE`. A success from a US IP would be a product bug.

## Factories and local URL

`PROXY_URL` (default `direct`) feeds the in-memory default row. Workers still resolve **lease → URL** so production jobs do not ignore Postgres.

`direct`, `localhost`, and `127.0.0.1` mean “no HTTP proxy” in adapters (undici / Playwright).

## Files

| File | Role |
|---|---|
| `src/proxy-pool.interface.ts` | Contract |
| `src/concurrency.ts` | Cap resolver + constants |
| `src/pool-options.ts` | Shared pool constructor options |
| `src/in-memory-pool.ts` | Same rules in RAM |
| `src/postgres-pool.ts` | SQL acquire/release/health |
| `src/factories.ts` | Backend selection + PG retry |
| `src/retry.ts` | Startup retry helper |

## Tests

`concurrency.spec.ts`, `in-memory-pool.spec.ts`, `postgres-pool.spec.ts` (pg-mem), `factories.spec.ts`, `retry.spec.ts`.

## Related

- [orchestrator](../orchestrator/README.md) — passes `plan.affinity` to acquire
- [DESIGN.md](../../DESIGN.md) §1.1, §8.3, §10.4–10.5
