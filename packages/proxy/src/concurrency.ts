import type { ProxyAffinity } from '@llm-query/types';

/**
 * Max simultaneous leases on one proxy for stateless (`affinity: none`) jobs.
 * v1 default is 1 (exclusive). Raise via env or pool options when inventory is scarce.
 */
export const DEFAULT_MAX_CONCURRENT_LEASES_PER_PROXY = 1;

/** Session/request plans must hold one egress exclusively — never share with another job. */
export const STICKY_MAX_CONCURRENT_LEASES = 1;

export interface ProxyConcurrencyOptions {
  /** Override for stateless acquires (tests / explicit wiring). */
  maxConcurrentPerProxy?: number;
}

function parseEnvMaxConcurrent(): number | undefined {
  const raw = process.env.PROXY_MAX_CONCURRENT_LEASES;
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return undefined;
  return Math.floor(n);
}

/** Effective per-proxy lease cap for this acquire. */
export function resolveMaxConcurrentLeases(
  affinity: ProxyAffinity | undefined,
  options?: ProxyConcurrencyOptions,
): number {
  if (affinity === 'session' || affinity === 'request') {
    return STICKY_MAX_CONCURRENT_LEASES;
  }
  if (options?.maxConcurrentPerProxy !== undefined) {
    return Math.max(1, Math.floor(options.maxConcurrentPerProxy));
  }
  const fromEnv = parseEnvMaxConcurrent();
  if (fromEnv !== undefined) {
    return fromEnv;
  }
  return DEFAULT_MAX_CONCURRENT_LEASES_PER_PROXY;
}
