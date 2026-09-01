import { firefox, type Browser, type Page, type LaunchOptions } from 'playwright';
import { isIntermediateAssistantText } from './intermediate-text';

const CHATGPT_URL = 'https://chatgpt.com/';
/** Guest composer selectors — ChatGPT has dropped #prompt-textarea on the unauth shell. */
const PROMPT_SELECTOR =
  '#prompt-textarea, textarea[placeholder*="Ask" i], [data-mobile-composer-prompt], div[contenteditable="true"], textarea';

export { isIntermediateAssistantText } from './intermediate-text';

export interface GuestTurnContext {
  prompt: string;
  proxyUrl: string;
  timeoutMs?: number;
  /** Resume an existing ChatGPT conversation URL when continuing. */
  conversationUrl?: string;
}

export interface GuestTurnResult {
  htmlPartial: string;
  pageUrl?: string;
}

export interface PlaywrightGuestDeps {
  launch?: (options?: LaunchOptions) => Promise<Browser>;
}

export function parsePlaywrightProxy(proxyUrl: string): LaunchOptions['proxy'] | undefined {
  if (!proxyUrl || proxyUrl === 'direct') return undefined;
  try {
    const url = new URL(proxyUrl);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return undefined;
    const server = `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ''}`;
    const proxy: LaunchOptions['proxy'] = { server };
    if (url.username) proxy.username = decodeURIComponent(url.username);
    if (url.password) proxy.password = decodeURIComponent(url.password);
    return proxy;
  } catch {
    return { server: proxyUrl };
  }
}

/** Guest full-send turn via Playwright headless Firefox (DESIGN.md ChatGPT v1). */
export async function runChatgptGuestTurn(
  ctx: GuestTurnContext,
  deps: PlaywrightGuestDeps = {},
): Promise<GuestTurnResult> {
  const launch = deps.launch ?? firefox.launch.bind(firefox);
  const timeout = ctx.timeoutMs ?? 120_000;
  const browser = await launch({
    headless: true,
    proxy: parsePlaywrightProxy(ctx.proxyUrl),
  });

  try {
    const page = await browser.newPage({ locale: 'en-US' });
    const startUrl = ctx.conversationUrl || CHATGPT_URL;
    await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout });
    await submitPrompt(page, ctx.prompt, timeout);
    const htmlPartial = await waitForAssistantHtml(page, timeout);
    return { htmlPartial, pageUrl: typeof page.url === 'function' ? page.url() : undefined };
  } finally {
    await browser.close();
  }
}

async function submitPrompt(page: Page, prompt: string, timeout: number): Promise<void> {
  const input = page.locator(PROMPT_SELECTOR).first();
  await input.waitFor({ state: 'visible', timeout });
  await input.click({ timeout });
  try {
    await input.fill(prompt, { timeout: Math.min(timeout, 15_000) });
  } catch {
    // contenteditable / custom composers may reject fill()
    await page.keyboard.type(prompt, { delay: 15 });
  }
  await page.keyboard.press('Enter');
}

async function waitForAssistantHtml(page: Page, timeout: number): Promise<string> {
  // Prefer markdown node — broader assistant containers can include guest-shell CSS.
  const deadline = Date.now() + timeout;
  const markdownSel = '[data-assistant-markdown]';
  const fallbackSel =
    '[data-message-author-role="assistant"], [data-message="assistant"]';
  const anySel = `${markdownSel}, ${fallbackSel}`;

  // Wait until *any* assistant node appears — markdown may lag a few seconds after submit.
  await page.locator(anySel).last().waitFor({
    state: 'visible',
    timeout: Math.max(1_000, deadline - Date.now()),
  });

  let assistant = page.locator(anySel).last();
  let lastReady = '';
  let stableHits = 0;
  let lastHtml = '';

  while (Date.now() < deadline) {
    // Re-prefer markdown once it appears (search status may show first in a parent).
    if ((await page.locator(markdownSel).count()) > 0) {
      assistant = page.locator(markdownSel).last();
    } else {
      assistant = page.locator(anySel).last();
    }

    const html = await assistant.innerHTML();
    lastHtml = html;
    const text = html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // CSS leaks are not a finished answer
    if (/@layer\b|:where\(|--[a-z]+-\d+\s*:/i.test(text) && text.length > 2_000) {
      lastReady = '';
      stableHits = 0;
      await page.waitForTimeout(250);
      continue;
    }
    if (text && !isIntermediateAssistantText(text)) {
      if (text === lastReady) {
        stableHits += 1;
        if (stableHits >= 3) return html;
      } else {
        lastReady = text;
        stableHits = 1;
      }
    } else {
      lastReady = '';
      stableHits = 0;
    }
    await page.waitForTimeout(250);
  }
  return lastHtml || assistant.innerHTML();
}
