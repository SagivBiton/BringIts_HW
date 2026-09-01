import { ProxyLease, ProxyAction } from '@llm-query/types';
import { randomBytes } from 'crypto';
import { resolveMaxConcurrentLeases } from './concurrency';
import type { AcquireRequest } from './in-memory-pool';
import { PROXY_BURN_AFTER_CONSECUTIVE } from './in-memory-pool';
import type { ProxyPoolOptions } from './pool-options';
import type { ProxyPool } from './proxy-pool.interface';

type PgClient = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export class PostgresProxyPool implements ProxyPool {
  constructor(
    private readonly db: PgClient,
    private readonly options: ProxyPoolOptions = {},
  ) {}

  async acquire(req: AcquireRequest): Promise<ProxyLease | null> {
    const now = new Date();
    const maxConcurrent = resolveMaxConcurrentLeases(req.affinity, this.options);
    const { rows } = await this.db.query<{
      id: string;
      url: string;
      geo: string;
    }>(
      `SELECT p.id, p.url, p.geo
       FROM proxies p
       LEFT JOIN (
         SELECT proxy_id, COUNT(*)::int AS active_leases
         FROM proxy_leases
         WHERE expires_at > $1
         GROUP BY proxy_id
       ) active ON active.proxy_id = p.id
       LEFT JOIN proxy_health h ON h.proxy_id = p.id AND h.target = $2
       WHERE p.enabled = true
         AND COALESCE(active.active_leases, 0) < $4
         AND ($3::text IS NULL OR p.geo = $3)
         AND (h.burned_until IS NULL OR h.burned_until <= $1)
         AND (h.cooldown_until IS NULL OR h.cooldown_until <= $1)
       ORDER BY COALESCE(active.active_leases, 0) ASC, COALESCE(h.score, 1) DESC
       LIMIT 1`,
      [now.toISOString(), req.target, req.geo ?? null, maxConcurrent],
    );

    if (rows.length === 0) return null;

    const proxy = rows[0];
    const lease_id = `lease_${randomBytes(8).toString('hex')}`;
    const expires_at = new Date(Date.now() + 120_000);
    await this.db.query(
      `INSERT INTO proxy_leases (lease_id, proxy_id, request_id, target, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [lease_id, proxy.id, req.request_id ?? 'unknown', req.target, expires_at.toISOString()],
    );

    return {
      id: lease_id,
      proxy_id: proxy.id,
      request_id: req.request_id ?? 'unknown',
      affinity: req.affinity ?? 'none',
      expires_at,
    };
  }

  async release(leaseId: string, action: ProxyAction): Promise<void> {
    const { rows } = await this.db.query<{ proxy_id: string; target: string }>(
      `DELETE FROM proxy_leases WHERE lease_id = $1 RETURNING proxy_id, target`,
      [leaseId],
    );
    if (rows.length === 0) return;
    await this.applyHealthAction(rows[0].proxy_id, rows[0].target, action);
  }

  async applyHealthAction(
    proxyId: string,
    target: string,
    action: ProxyAction,
  ): Promise<void> {
    const now = new Date().toISOString();
    switch (action) {
      case 'success_signal':
        await this.db.query(
          `INSERT INTO proxy_health (proxy_id, target, score, consecutive_failures)
           VALUES ($1, $2, 1, 0)
           ON CONFLICT (proxy_id, target) DO UPDATE SET
             score = LEAST(1, proxy_health.score + 0.1),
             consecutive_failures = 0`,
          [proxyId, target],
        );
        break;
      case 'cooldown':
        await this.db.query(
          `INSERT INTO proxy_health (proxy_id, target, score, consecutive_failures, cooldown_until)
           VALUES ($1, $2, 0.7, 1, $3::timestamptz + interval '5 minutes')
           ON CONFLICT (proxy_id, target) DO UPDATE SET
             score = GREATEST(0, proxy_health.score - 0.3),
             consecutive_failures = proxy_health.consecutive_failures + 1,
             cooldown_until = $3::timestamptz + interval '5 minutes'`,
          [proxyId, target, now],
        );
        {
          const { rows } = await this.db.query<{ consecutive_failures: number }>(
            `SELECT consecutive_failures FROM proxy_health WHERE proxy_id = $1 AND target = $2`,
            [proxyId, target],
          );
          if ((rows[0]?.consecutive_failures ?? 0) >= PROXY_BURN_AFTER_CONSECUTIVE) {
            await this.db.query(
              `UPDATE proxy_health SET score = 0, burned_until = $3::timestamptz + interval '1 hour'
               WHERE proxy_id = $1 AND target = $2`,
              [proxyId, target, now],
            );
          }
        }
        break;
      case 'burn':
        await this.db.query(
          `INSERT INTO proxy_health (proxy_id, target, score, burned_until)
           VALUES ($1, $2, 0, $3::timestamptz + interval '1 hour')
           ON CONFLICT (proxy_id, target) DO UPDATE SET
             score = 0,
             burned_until = $3::timestamptz + interval '1 hour'`,
          [proxyId, target, now],
        );
        break;
      case 'neutral':
      case 'none':
        break;
    }
  }

  async getProxyUrl(proxyId: string): Promise<string | undefined> {
    const { rows } = await this.db.query<{ url: string }>(
      `SELECT url FROM proxies WHERE id = $1`,
      [proxyId],
    );
    return rows[0]?.url;
  }

  async getLeaseProxyUrl(leaseId: string): Promise<string | undefined> {
    const { rows } = await this.db.query<{ url: string }>(
      `SELECT p.url FROM proxy_leases l
       JOIN proxies p ON p.id = l.proxy_id
       WHERE l.lease_id = $1`,
      [leaseId],
    );
    return rows[0]?.url;
  }
}
