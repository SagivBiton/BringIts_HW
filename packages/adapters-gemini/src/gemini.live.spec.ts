import { geminiHttpStep } from './steps/generate.http';
import { geminiAdapter } from './adapter';

const LIVE = process.env.LIVE_INTEGRATION === '1';

(LIVE ? describe : describe.skip)('geminiHttpStep (live)', () => {
  jest.setTimeout(60_000);

  it('completes a guest generate on gemini.google.com', async () => {
    const result = await geminiHttpStep({
      proxyUrl: process.env.PROXY_URL ?? '',
      prompt: 'Reply with exactly: pong',
    });

    expect(result.artifacts.bootstrapFailed).not.toBe(true);
    expect(String(result.artifacts.streamBody).length).toBeGreaterThan(0);

    const parsed = geminiAdapter.parse(
      { streamBody: String(result.artifacts.streamBody) },
      { parse: true },
    );
    expect(parsed.response_text.length).toBeGreaterThan(0);
    expect(String(result.artifacts.streamBody).toLowerCase()).not.toContain(
      'verify you are human',
    );
  });
});
