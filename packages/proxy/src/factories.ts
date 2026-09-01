import { Client } from 'pg';
import { InMemoryProxyPool, type ProxyRow } from './in-memory-pool';
import { PostgresProxyPool } from './postgres-pool';
import type { ProxyPool } from './proxy-pool.interface';
import { withRetry } from './retry';

const DEFAULT_LOCAL: ProxyRow = {
  id: 'local',
  url: process.env.PROXY_URL ?? 'direct',
  geo: 'US',
  kind: 'local-test',
  mode: 'stateless',
  enabled: true,
};

export function createInMemoryProxyPool(rows?: ProxyRow[]): InMemoryProxyPool {
  return new InMemoryProxyPool(rows ?? [DEFAULT_LOCAL]);
}

async function connectPostgres(connectionString: string): Promise<Client> {
  return withRetry(
    async () => {
      const client = new Client({ connectionString });
      try {
        await client.connect();
        return client;
      } catch (err) {
        await client.end().catch(() => undefined);
        throw err;
      }
    },
    {
      // Docker DNS can flap (EAI_AGAIN) right after depends_on healthy.
      attempts: Number(process.env.PG_CONNECT_ATTEMPTS ?? 30),
      delayMs: Number(process.env.PG_CONNECT_DELAY_MS ?? 1000),
    },
  );
}

/** Use Postgres when DATABASE_URL is set; otherwise in-memory local-test pool. */
export async function createProxyPool(databaseUrl?: string): Promise<ProxyPool> {
  if (!databaseUrl) {
    return createInMemoryProxyPool();
  }
  const client = await connectPostgres(databaseUrl);
  return new PostgresProxyPool(client);
}
