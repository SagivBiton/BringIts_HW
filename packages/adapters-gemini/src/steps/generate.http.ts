import type { JobPayload } from '@llm-query/types';
import { parseRetryAfterMs } from '@llm-query/errors';
import { createProxiedFetch } from '../proxied-fetch';

export interface StepContext {
  proxyUrl: string;
  prompt: string;
  job?: JobPayload;
  fetchImpl?: typeof fetch;
}

export interface StepResult {
  artifacts: Record<string, unknown>;
}

/** Gemini v1: GET /app bootstrap + POST StreamGenerate in one HTTP step. */
export async function geminiHttpStep(ctx: StepContext): Promise<StepResult> {
  const fetchFn = ctx.fetchImpl ?? createProxiedFetch(ctx.proxyUrl);
  const appRes = await fetchFn('https://gemini.google.com/app', {
    headers: { Accept: 'text/html' },
  });
  if (appRes.status === 429) {
    return {
      artifacts: {
        streamBody: await appRes.text().catch(() => ''),
        httpStatus: 429,
        retryAfterMs: parseRetryAfterMs(appRes.headers.get('retry-after')),
        bootstrapFailed: true,
      },
    };
  }
  const html = await appRes.text();
  const fsid = html.match(/"FdrFJe":"([^"]+)"/)?.[1];
  const bl = html.match(/"cfb2h":"([^"]+)"/)?.[1];
  if (!fsid || !bl) {
    return {
      artifacts: {
        streamBody: '',
        bootstrapFailed: true,
        httpStatus: appRes.status,
      },
    };
  }

  const inner = [
    [ctx.prompt, 0, null, null, null, null, 0],
    ['en-US'],
    ['', '', '', null, null, null, null, null, null, ''],
    'INVALID_TOKEN',
    'deadbeef',
    null,
    [0],
    1,
  ];
  const fReq = JSON.stringify([null, JSON.stringify(inner)]);
  const qs = new URLSearchParams({
    bl,
    'f.sid': fsid,
    hl: 'en-US',
    _reqid: '1',
    rt: 'c',
  });
  const url =
    'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?' +
    qs.toString();
  const genRes = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Origin: 'https://gemini.google.com',
      Referer: 'https://gemini.google.com/',
      'X-Same-Domain': '1',
    },
    body: new URLSearchParams({ 'f.req': fReq }).toString(),
  });
  const streamBody = await genRes.text();
  const artifacts: Record<string, unknown> = {
    streamBody,
    httpStatus: genRes.status,
  };
  const retryAfterMs = parseRetryAfterMs(genRes.headers.get('retry-after'));
  if (retryAfterMs !== undefined) {
    artifacts.retryAfterMs = retryAfterMs;
  }
  return { artifacts };
}


export const geminiHttpStepMeta = {
  id: 'generate',
  worker: 'http' as const,
  source: 'gemini' as const,
  run: async (ctx: StepContext) => geminiHttpStep(ctx),
};

export function geminiHttpStepFromJob(job: JobPayload, proxyUrl: string, prompt: string) {
  return geminiHttpStep({ proxyUrl, prompt, job });
}
