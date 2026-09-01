# `@llm-query/adapters-chatgpt` — guest Firefox full-send

ChatGPT v1 is **one browser step**: Playwright **headless Firefox** loads the guest UI, types the prompt, waits for assistant HTML, returns a partial. No OpenAI API, no login, no personal cookies.

Headless Chromium was not a working path (Cloudflare). Pure HTTP failed the verification gate. Those findings are why this adapter is browser-tagged and why the runtime is Firefox-only.

## Adapter (`src/adapter.ts`)

### `plan`

Same shape as Gemini, different worker:

- `{ id: 'generate', worker: 'browser', purpose: 'generate' }`
- Follow-up: `affinity: 'session'` so the same conversation URL can be reused

### `parse`

HTML is hostile (guest shell CSS, tool status lines). Extraction order:

1. `data-assistant-markdown` (preferred)
2. Simple `<p>` inside that node
3. `data-message-author-role="assistant"`
4. Legacy `data-message="assistant"`
5. Stripped full partial as last resort

`isIntermediateAssistantText` drops “Searching the web”, “Thinking”, etc. `cleanAssistantProse` cuts leaked `@layer` / theme tokens. Intermediate-only text becomes `''` so the orchestrator can emit `EMPTY_RESPONSE` instead of a fake answer.

`parse: false` → `payload: { htmlPartial, pageUrl }`. `target_session.chatgpt_url` is the page URL for the next turn.

### `classify`

Verification-gate copy or `cdn-cgi/challenge` → `TARGET_BLOCKED`. Empty HTML → `EMPTY_RESPONSE`.

## Step (`src/steps/generate.browser.ts`)

Thin: call `runChatgptGuestTurn` unless tests inject `runBrowser`. Reads `job.artifacts.chatgpt_url` for continue.

`chatgptBrowserStepMeta` is what `worker-browser` registers.

## Playwright guest (`src/playwright-guest.ts`)

- Launch Firefox headless; Playwright `proxy` from lease URL (`direct` / localhost → no proxy)
- `locale: 'en-US'`
- Composer selectors are defensive: ChatGPT dropped `#prompt-textarea` on the unauth shell (`textarea[placeholder*="Ask"]`, contenteditable, …)
- `fill` then fallback `keyboard.type` for custom composers
- Wait loop: prefer markdown node; require **stable** non-intermediate text (3 identical samples) so search status is not the final answer
- Always `browser.close()` in `finally`

## What this is not

[CHATGPT_HTTP_GUEST_POC.md](./CHATGPT_HTTP_GUEST_POC.md) documents a curl-impersonate + Sentinel + Turnstile spike. **Not implemented** as the v1 step. Tokens were one-shot; hybrid mint+HTTP was not faster than full-send given Firefox startup. Kept for a possible future `generate.http.ts`.

## Tests

- `adapter.spec.ts` — HTML fixtures, CSS leak, intermediate text
- `playwright-guest.spec.ts` — proxy parse, selector/wait helpers with mocks
- `playwright-guest.live.spec.ts` — `LIVE_INTEGRATION=1`

## Related

- [worker-browser](../../apps/worker-browser/README.md)
- [DESIGN.md](../../DESIGN.md) §4 ChatGPT table
