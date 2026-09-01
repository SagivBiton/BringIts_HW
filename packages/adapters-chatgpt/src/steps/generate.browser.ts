import type { JobPayload } from '@llm-query/types';
import { runChatgptGuestTurn } from '../playwright-guest';

export interface BrowserStepContext {
  proxyUrl: string;
  prompt: string;
  job?: JobPayload;
  /** Injectable for tests; production uses Playwright Firefox. */
  runBrowser?: (
    ctx: BrowserStepContext,
  ) => Promise<{ htmlPartial: string; pageUrl?: string }>;
}

export interface StepResult {
  artifacts: Record<string, unknown>;
}

/** ChatGPT v1: full guest turn in headless Firefox. */
export async function chatgptBrowserStep(
  ctx: BrowserStepContext,
): Promise<StepResult> {
  const runner =
    ctx.runBrowser ??
    (async (c) => {
      const conversationUrl = c.job?.artifacts?.chatgpt_url;
      return runChatgptGuestTurn({
        prompt: c.prompt,
        proxyUrl: c.proxyUrl,
        conversationUrl:
          typeof conversationUrl === 'string' ? conversationUrl : undefined,
      });
    });
  const { htmlPartial, pageUrl } = await runner(ctx);
  return { artifacts: { htmlPartial, pageUrl } };
}

export const chatgptBrowserStepMeta = {
  id: 'generate',
  worker: 'browser' as const,
  source: 'chatgpt' as const,
  run: async (ctx: BrowserStepContext) => chatgptBrowserStep(ctx),
};

export function chatgptBrowserStepFromJob(
  job: JobPayload,
  proxyUrl: string,
  prompt: string,
  runBrowser?: BrowserStepContext['runBrowser'],
) {
  return chatgptBrowserStep({ proxyUrl, prompt, runBrowser, job });
}
