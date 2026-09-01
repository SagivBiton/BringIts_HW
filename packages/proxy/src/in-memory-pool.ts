import { ProxyLease, ProxyAction, ProxyAffinity } from '@llm-query/types';
import { randomBytes } from 'crypto';
import { resolveMaxConcurrentLeases } from './concurrency';
import type { ProxyPoolOptions } from './pool-options';
import type { ProxyPool } from './proxy-pool.interface';

/** Soft blocks/rate-limits escalate to burn after this many consecutive cooldowns. */
export const PROXY_BURN_AFTER_CONSECUTIVE = 3;

export interface ProxyRow {
  id: string;
  url: string;
  geo: string;
  kind: string;
  mode: 'stateless' | 'stateful';
  enabled: boolean;
}

export interface AcquireRequest {
  target: string;
  geo?: string;
  request_id?: string;
  /** When `session` or `request`, the proxy is exclusive (max 1 lease). */
  affinity?: ProxyAffinity;
}

interface HealthRow {
  score: number;
  consecutive_failures: number;
  cooldown_until: Date | null;
  burned_until: Date | null;
}

interface LeaseRow {
  lease_id: string;
  proxy_id: string;
  request_id: string;
  target: string;
  expires_at: Date;
}

/** In-memory stand-in for Postgres pool; same contract as production store. */
export class InMemoryProxyPool implements ProxyPool {
  private readonly proxies: Map<string, ProxyRow>;
  private readonly health = new Map<string, HealthRow>();
  private readonly leases = new Map<string, LeaseRow>();
  private readonly options: ProxyPoolOptions;

  constructor(rows: ProxyRow[], options: ProxyPoolOptions = {}) {
    this.proxies = new Map(rows.map((r) => [r.id, r]));
    this.options = options;
  }

  async acquire(req: AcquireRequest): Promise<ProxyLease | null> {
    const now = new Date();
    const maxConcurrent = resolveMaxConcurrentLeases(req.affinity, this.options);
    const candidates = [...this.proxies.values()].filter((p) => {
      if (!p.enabled) return false;
      if (this.activeLeaseCount(p.id, now) >= maxConcurrent) return false;
      if (req.geo && p.geo !== req.geo) return false;
      const h = this.getHealth(p.id, req.target);
      if (h.burned_until && h.burned_until > now) return false;
      if (h.cooldown_until && h.cooldown_until > now) return false;
      return true;
    });

    if (candidates.length === 0) return null;

    const proxy = candidates.sort((a, b) => {
      const load =
        this.activeLeaseCount(a.id, now) - this.activeLeaseCount(b.id, now);
      if (load !== 0) return load;
      return this.getHealth(b.id, req.target).score - this.getHealth(a.id, req.target).score;
    })[0];

    const lease_id = `lease_${randomBytes(8).toString('hex')}`;
    const expires_at = new Date(Date.now() + 120_000);
    this.leases.set(lease_id, {
      lease_id,
      proxy_id: proxy.id,
      request_id: req.request_id ?? 'unknown',
      target: req.target,
      expires_at,
    });

    return {
      id: lease_id,
      proxy_id: proxy.id,
      request_id: req.request_id ?? 'unknown',
      affinity: req.affinity ?? 'none',
      expires_at,
    };
  }

  async release(leaseId: string, action: ProxyAction): Promise<void> {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    this.leases.delete(leaseId);
    this.applyHealthActionSync(lease.proxy_id, lease.target, action);
  }

  async applyHealthAction(
    proxyId: string,
    target: string,
    action: ProxyAction,
  ): Promise<void> {
    this.applyHealthActionSync(proxyId, target, action);
  }

  getProxyUrl(proxyId: string): string | undefined {
    return this.proxies.get(proxyId)?.url;
  }

  getLeaseProxyUrl(leaseId: string): string | undefined {
    const lease = this.leases.get(leaseId);
    if (!lease) return undefined;
    return this.getProxyUrl(lease.proxy_id);
  }

  private applyHealthActionSync(
    proxyId: string,
    target: string,
    action: ProxyAction,
  ): void {
    const h = this.getHealth(proxyId, target);
    const now = Date.now();
    switch (action) {
      case 'success_signal':
        h.score = Math.min(1, h.score + 0.1);
        h.consecutive_failures = 0;
        break;
      case 'cooldown':
        h.score = Math.max(0, h.score - 0.3);
        h.consecutive_failures += 1;
        h.cooldown_until = new Date(now + 5 * 60_000);
        if (h.consecutive_failures >= PROXY_BURN_AFTER_CONSECUTIVE) {
          h.score = 0;
          h.burned_until = new Date(now + 60 * 60_000);
        }
        break;
      case 'burn':
        h.score = 0;
        h.burned_until = new Date(now + 60 * 60_000);
        break;
      case 'neutral':
        break;
      case 'none':
        break;
    }
    this.health.set(this.healthKey(proxyId, target), h);
  }

  private getHealth(proxyId: string, target: string): HealthRow {
    const key = this.healthKey(proxyId, target);
    if (!this.health.has(key)) {
      this.health.set(key, {
        score: 1,
        consecutive_failures: 0,
        cooldown_until: null,
        burned_until: null,
      });
    }
    return this.health.get(key)!;
  }

  private healthKey(proxyId: string, target: string): string {
    return `${proxyId}:${target}`;
  }

  private activeLeaseCount(proxyId: string, now: Date): number {
    let count = 0;
    for (const lease of this.leases.values()) {
      if (lease.proxy_id === proxyId && lease.expires_at > now) {
        count += 1;
      }
    }
    return count;
  }
}
