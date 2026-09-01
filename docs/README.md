# Documentation

This folder is the map. Implementation lives in `apps/` and `packages/`; locked product/architecture decisions live in the repo-root [DESIGN.md](../DESIGN.md).

## How to read this project

If you have ten minutes: root [README.md](../README.md) (setup, API, architecture, **scraping approach**, challenges).

If you have thirty minutes: [DESIGN.md](../DESIGN.md) sections 1, 5, 8, 10 (components, principles, abstractions, errors).

If you are learning the code: follow one query through the package READMEs in this order:

1. [types](../packages/types/README.md) — what a query *is*
2. [api](../apps/api/README.md) — how it enters the system
3. [orchestrator](../packages/orchestrator/README.md) — how a plan is executed
4. [proxy](../packages/proxy/README.md) + [queue](../packages/queue/README.md) — egress and jobs
5. [worker-runtime](../packages/worker-runtime/README.md) + the matching worker app
6. [adapters-gemini](../packages/adapters-gemini/README.md) or [adapters-chatgpt](../packages/adapters-chatgpt/README.md)
7. [errors](../packages/errors/README.md) — why a 200 can still be a failure

## What “good design” means here

The interesting engineering is not “we called an LLM.” It is:

- **Separation of runtimes** so Gemini never occupies a Firefox slot
- **Declared execution** (`ExecutionPlan`) instead of orchestrator hard-coding
- **Leaf types package** to avoid circular imports
- **Classify-before-parse** so block pages cannot become answers
- **Proxy health per target** so burns are not global
- **Honest failure modes** (`GEO_UNAVAILABLE` instead of a surprise IP from another country)

## Historical / research notes

- [packages/adapters-chatgpt/CHATGPT_HTTP_GUEST_POC.md](../packages/adapters-chatgpt/CHATGPT_HTTP_GUEST_POC.md) — HTTP guest spike that is **not** the v1 path; kept for a possible future HTTP step
