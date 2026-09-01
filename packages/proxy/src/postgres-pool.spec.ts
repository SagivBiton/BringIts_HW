import { newDb } from 'pg-mem';
import { PostgresProxyPool } from '../src/postgres-pool';
import type { ProxyPoolOptions } from '../src/pool-options';

const SCHEMA = `
CREATE TABLE proxies (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  geo TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  enabled BOOLEAN NOT NULL
);
CREATE TABLE proxy_health (
  proxy_id TEXT NOT NULL REFERENCES proxies(id),
  target TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 1,
  consecutive_failures INT NOT NULL DEFAULT 0,
  cooldown_until TIMESTAMPTZ,
  burned_until TIMESTAMPTZ,
  PRIMARY KEY (proxy_id, target)
);
CREATE TABLE proxy_leases (
  lease_id TEXT PRIMARY KEY,
  proxy_id TEXT NOT NULL REFERENCES proxies(id),
  request_id TEXT NOT NULL,
  target TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
`;

function createTestPool(
  rows: Array<{
    id: string;
    url: string;
    geo: string;
    kind: string;
    mode: 'stateless' | 'stateful';
    enabled: boolean;
  }>,
  options?: ProxyPoolOptions,
) {
  const db = newDb();
  db.public.none(SCHEMA);
  for (const row of rows) {
    db.public.none(
      `INSERT INTO proxies (id, url, geo, kind, mode, enabled) VALUES ('${row.id}', '${row.url}', '${row.geo}', '${row.kind}', '${row.mode}', ${row.enabled})`,
    );
  }
  const adapter = db.adapters.createPg();
  const client = new adapter.Client();
  client.connect();
  return new PostgresProxyPool(client, options);
}

describe('PostgresProxyPool', () => {
  it('leases a healthy proxy when geo omitted', async () => {
    const pool = createTestPool([
      { id: 'p1', url: 'http://proxy:8080', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    const lease = await pool.acquire({ target: 'gemini' });
    expect(lease?.proxy_id).toBe('p1');
  });

  it('returns null when explicit geo has no proxy', async () => {
    const pool = createTestPool([
      { id: 'p1', url: 'http://proxy:8080', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    const lease = await pool.acquire({ target: 'gemini', geo: 'DE' });
    expect(lease).toBeNull();
  });

  it('excludes burned proxies per target', async () => {
    const pool = createTestPool([
      { id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
      { id: 'p2', url: 'http://b', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true },
    ]);
    await pool.applyHealthAction('p1', 'gemini', 'burn');
    const lease = await pool.acquire({ target: 'gemini', geo: 'US' });
    expect(lease?.proxy_id).toBe('p2');
  });

  it('allows configured concurrent leases on one proxy', async () => {
    const pool = createTestPool(
      [{ id: 'p1', url: 'http://a', geo: 'US', kind: 'residential', mode: 'stateless', enabled: true }],
      { maxConcurrentPerProxy: 2 },
    );
    const a = await pool.acquire({ target: 'gemini', affinity: 'none' });
    const b = await pool.acquire({ target: 'gemini', affinity: 'none' });
    expect(a?.proxy_id).toBe('p1');
    expect(b?.proxy_id).toBe('p1');
    expect(await pool.acquire({ target: 'gemini', affinity: 'none' })).toBeNull();
  });
});
