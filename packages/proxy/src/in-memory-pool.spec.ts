import { InMemoryProxyPool } from '../src/in-memory-pool';

describe('InMemoryProxyPool', () => {
  it('leases a healthy proxy from default pool when geo omitted', async () => {
    const pool = new InMemoryProxyPool([
      { id: 'p1', url: 'http://proxy:8080', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    const lease = await pool.acquire({ target: 'gemini' });
    expect(lease).not.toBeNull();
    expect(lease!.proxy_id).toBe('p1');
    expect(lease!.request_id).toBeDefined();
  });

  it('returns null when explicit geo has no healthy proxy', async () => {
    const pool = new InMemoryProxyPool([
      { id: 'p1', url: 'http://proxy:8080', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    const lease = await pool.acquire({ target: 'gemini', geo: 'DE' });
    expect(lease).toBeNull();
  });

  it('excludes burned proxies for a target', async () => {
    const pool = new InMemoryProxyPool([
      { id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
      { id: 'p2', url: 'http://b', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    await pool.applyHealthAction('p1', 'gemini', 'burn');
    const lease = await pool.acquire({ target: 'gemini', geo: 'US' });
    expect(lease?.proxy_id).toBe('p2');
  });

  it('still allows burned proxy for a different target', async () => {
    const pool = new InMemoryProxyPool([
      { id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    await pool.applyHealthAction('p1', 'chatgpt', 'burn');
    const lease = await pool.acquire({ target: 'gemini', geo: 'US' });
    expect(lease?.proxy_id).toBe('p1');
  });

  it('releases lease so proxy can be reused', async () => {
    const pool = new InMemoryProxyPool([
      { id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    const lease = await pool.acquire({ target: 'gemini' });
    expect(lease).not.toBeNull();
    await pool.release(lease!.id, 'success_signal');
    const again = await pool.acquire({ target: 'gemini' });
    expect(again?.proxy_id).toBe('p1');
  });

  it('resolves proxy url from an active lease', async () => {
    const pool = new InMemoryProxyPool([
      { id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    const lease = await pool.acquire({ target: 'gemini' });
    expect(pool.getLeaseProxyUrl(lease!.id)).toBe('http://a');
  });

  it('cooldown after release excludes proxy for that target', async () => {
    const pool = new InMemoryProxyPool([
      { id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    const lease = await pool.acquire({ target: 'gemini' });
    await pool.release(lease!.id, 'cooldown');
    expect(await pool.acquire({ target: 'gemini' })).toBeNull();
    expect(await pool.acquire({ target: 'chatgpt' })).not.toBeNull();
  });

  it('escalates to burn after consecutive cooldowns', async () => {
    jest.useFakeTimers();
    const pool = new InMemoryProxyPool([
      { id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    for (let i = 0; i < 3; i++) {
      const lease = await pool.acquire({ target: 'gemini' });
      expect(lease).not.toBeNull();
      await pool.release(lease!.id, 'cooldown');
      // Advance past cooldown window so we can re-acquire until burn sticks.
      jest.advanceTimersByTime(6 * 60_000);
    }
    expect(await pool.acquire({ target: 'gemini' })).toBeNull();
    // Still available for a different target.
    expect(await pool.acquire({ target: 'chatgpt' })).not.toBeNull();
    jest.useRealTimers();
  });

  it('allows N concurrent leases on one proxy when configured (default remains 1)', async () => {
    const pool = new InMemoryProxyPool(
      [{ id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true }],
      { maxConcurrentPerProxy: 2 },
    );
    const first = await pool.acquire({ target: 'gemini', affinity: 'none' });
    const second = await pool.acquire({ target: 'gemini', affinity: 'none' });
    expect(first?.proxy_id).toBe('p1');
    expect(second?.proxy_id).toBe('p1');
    expect(await pool.acquire({ target: 'gemini', affinity: 'none' })).toBeNull();
    await pool.release(first!.id, 'neutral');
    const third = await pool.acquire({ target: 'gemini', affinity: 'none' });
    expect(third?.proxy_id).toBe('p1');
  });

  it('keeps session affinity exclusive even when pool allows higher concurrency', async () => {
    const pool = new InMemoryProxyPool(
      [{ id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true }],
      { maxConcurrentPerProxy: 3 },
    );
    const first = await pool.acquire({ target: 'gemini', affinity: 'session' });
    expect(first).not.toBeNull();
    expect(await pool.acquire({ target: 'gemini', affinity: 'session' })).toBeNull();
  });

  it('blocks a second lease on the same proxy with default cap 1', async () => {
    const pool = new InMemoryProxyPool([
      { id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    const first = await pool.acquire({ target: 'gemini' });
    expect(first).not.toBeNull();
    expect(await pool.acquire({ target: 'gemini' })).toBeNull();
  });
});
