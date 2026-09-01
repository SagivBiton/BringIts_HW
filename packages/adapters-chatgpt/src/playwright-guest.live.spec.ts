import { runChatgptGuestTurn } from './playwright-guest';
import { chatgptAdapter } from './adapter';

const LIVE = process.env.LIVE_INTEGRATION === '1';

(LIVE ? describe : describe.skip)('runChatgptGuestTurn (live)', () => {
  jest.setTimeout(180_000);

  it('completes a guest hello turn on chatgpt.com', async () => {
    const { htmlPartial } = await runChatgptGuestTurn({
      prompt: 'Reply with exactly: pong',
      proxyUrl: process.env.PROXY_URL ?? '',
      timeoutMs: 120_000,
    });
    const parsed = chatgptAdapter.parse({ htmlPartial }, { parse: true });
    expect(parsed.response_text.length).toBeGreaterThan(0);
    expect(htmlPartial.toLowerCase()).not.toContain('verification could not be completed');
  });
});
