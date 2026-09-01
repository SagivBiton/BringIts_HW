import { ProxyLease, ProxyAction } from '@llm-query/types';
import type { AcquireRequest } from './in-memory-pool';

/** Shared contract for in-memory and Postgres proxy pools. */
export interface ProxyPool {
  acquire(req: AcquireRequest): Promise<ProxyLease | null>;
  release(leaseId: string, action: ProxyAction): Promise<void>;
  applyHealthAction(
    proxyId: string,
    target: string,
    action: ProxyAction,
  ): Promise<void>;
  getProxyUrl(proxyId: string): Promise<string | undefined> | string | undefined;
  getLeaseProxyUrl(leaseId: string): Promise<string | undefined> | string | undefined;
}
