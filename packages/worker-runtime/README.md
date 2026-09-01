# `@llm-query/worker-runtime` — explicit step registry

Workers are **runtimes**. They must not glob `packages/*/steps` at startup (Nest bundling, Docker, and “forgot to copy a file” all fail that pattern).

Instead, each adapter **exports** a `StepRegistration`. The HTTP app imports HTTP metas only; the browser app imports browser metas only. The HTTP image graph never reaches Playwright.

## `StepRegistration`

```
id          // e.g. "generate" — matches ExecutionPlan.steps[].id
worker      // "http" | "browser"
source      // "gemini" | "chatgpt"
run({ proxyUrl, prompt, job }) → { artifacts }
```

Key in the map: `` `${source}:${id}` ``. The job carries `source` + `step_id`; `runRegisteredStep` looks up that key or throws `Step not registered`.

## `buildStepRegistry(steps, worker?)`

Optional `worker` filter: `worker-http` passes `'http'` so a mistaken import of a browser step would still be dropped. Defense in depth on top of import graphs.

## Why this matters

- **Independent scale:** HTTP replicas do not load Firefox.
- **Hybrid later:** a new adapter can export `mint` (browser) and `spend` (http); each fleet already knows how to look up `source:step_id`.
- **Testability:** tests pass a registry whose `run` returns canned artifacts — no network.

## Tests

`src/registry.spec.ts` — filter, lookup, missing step.

## Related

- [adapters-gemini](../adapters-gemini/README.md) — `geminiHttpStepMeta`
- [adapters-chatgpt](../adapters-chatgpt/README.md) — `chatgptBrowserStepMeta`
- [DESIGN.md](../../DESIGN.md) §1.2 worker composition
