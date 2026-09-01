import { withRetry } from './retry';

describe('withRetry', () => {
  it('returns on first success', async () => {
    const result = await withRetry(async () => 'ok', { attempts: 3, delayMs: 1 });
    expect(result).toBe('ok');
  });

  it('retries through transient failures then succeeds', async () => {
    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 3) {
          throw Object.assign(new Error('getaddrinfo EAI_AGAIN postgres'), {
            code: 'EAI_AGAIN',
          });
        }
        return 'connected';
      },
      { attempts: 5, delayMs: 1 },
    );
    expect(result).toBe('connected');
    expect(n).toBe(3);
  });

  it('rethrows after exhausting attempts', async () => {
    await expect(
      withRetry(
        async () => {
          throw Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' });
        },
        { attempts: 2, delayMs: 1 },
      ),
    ).rejects.toMatchObject({ code: 'EAI_AGAIN' });
  });
});
