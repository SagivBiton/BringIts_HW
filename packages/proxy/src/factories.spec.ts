import { createProxyPool, createInMemoryProxyPool } from './factories';

describe('createProxyPool', () => {
  it('returns in-memory pool when DATABASE_URL is omitted', async () => {
    const pool = await createProxyPool();
    const lease = await pool.acquire({ target: 'gemini' });
    expect(lease?.proxy_id).toBe('local');
  });

  it('createInMemoryProxyPool leases seeded rows', async () => {
    const pool = createInMemoryProxyPool([
      {
        id: 'p1',
        url: 'http://a',
        geo: 'US',
        kind: 'residential',
        mode: 'stateless',
        enabled: true,
      },
    ]);
    const lease = await pool.acquire({ target: 'gemini' });
    expect(lease?.proxy_id).toBe('p1');
  });
});
