import { geminiHttpStep } from './generate.http';
import { geminiAdapter } from '../adapter';

describe('geminiHttpStep', () => {
  it('bootstraps from /app then POSTs StreamGenerate', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/app')) {
        return new Response('{"FdrFJe":"sid123","cfb2h":"bl456"}', { status: 200 });
      }
      return new Response('"Hello from gemini"', { status: 200 });
    }) as typeof fetch;

    const result = await geminiHttpStep({
      proxyUrl: '',
      prompt: 'hello',
      fetchImpl,
    });

    expect(calls[0].url).toContain('gemini.google.com/app');
    expect(calls[1].url).toContain('StreamGenerate');
    expect(calls[1].url).toContain('f.sid=sid123');
    expect(calls[1].url).toContain('bl=bl456');
    expect(calls[1].init?.method).toBe('POST');
    expect(result.artifacts.streamBody).toBe('"Hello from gemini"');
    expect(result.artifacts.httpStatus).toBe(200);
  });

  it('returns bootstrapFailed when sid/bl missing', async () => {
    const fetchImpl = (async () =>
      new Response('<html>no tokens</html>', { status: 200 })) as typeof fetch;
    const result = await geminiHttpStep({
      proxyUrl: '',
      prompt: 'hello',
      fetchImpl,
    });
    expect(result.artifacts.bootstrapFailed).toBe(true);
    expect(result.artifacts.streamBody).toBe('');
  });

  it('parsed live-shaped stream yields response_text', async () => {
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/app')) {
        return new Response('{"FdrFJe":"s","cfb2h":"b"}', { status: 200 });
      }
      return new Response('prefix "Hello there" suffix', { status: 200 });
    }) as typeof fetch;
    const result = await geminiHttpStep({
      proxyUrl: '',
      prompt: 'hi',
      fetchImpl,
    });
    const parsed = geminiAdapter.parse(
      { streamBody: String(result.artifacts.streamBody) },
      { parse: true },
    );
    expect(parsed.response_text).toBe('Hello there');
  });

  it('surfaces HTTP 429 and Retry-After from StreamGenerate', async () => {
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/app')) {
        return new Response('{"FdrFJe":"s","cfb2h":"b"}', { status: 200 });
      }
      return new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '7' },
      });
    }) as typeof fetch;
    const result = await geminiHttpStep({
      proxyUrl: '',
      prompt: 'hi',
      fetchImpl,
    });
    expect(result.artifacts.httpStatus).toBe(429);
    expect(result.artifacts.retryAfterMs).toBe(7000);
    expect(result.artifacts.streamBody).toBe('rate limited');
  });

  it('surfaces HTTP 429 from bootstrap /app', async () => {
    const fetchImpl = (async () =>
      new Response('slow down', {
        status: 429,
        headers: { 'Retry-After': '3' },
      })) as typeof fetch;
    const result = await geminiHttpStep({
      proxyUrl: '',
      prompt: 'hi',
      fetchImpl,
    });
    expect(result.artifacts.httpStatus).toBe(429);
    expect(result.artifacts.retryAfterMs).toBe(3000);
    expect(result.artifacts.bootstrapFailed).toBe(true);
  });
});
