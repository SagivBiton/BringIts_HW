import {
  DEFAULT_MAX_CONCURRENT_LEASES_PER_PROXY,
  STICKY_MAX_CONCURRENT_LEASES,
  resolveMaxConcurrentLeases,
} from '../src/concurrency';

describe('resolveMaxConcurrentLeases', () => {
  const env = process.env.PROXY_MAX_CONCURRENT_LEASES;

  afterEach(() => {
    if (env === undefined) {
      delete process.env.PROXY_MAX_CONCURRENT_LEASES;
    } else {
      process.env.PROXY_MAX_CONCURRENT_LEASES = env;
    }
  });

  it('defaults stateless to 1', () => {
    delete process.env.PROXY_MAX_CONCURRENT_LEASES;
    expect(resolveMaxConcurrentLeases(undefined)).toBe(
      DEFAULT_MAX_CONCURRENT_LEASES_PER_PROXY,
    );
    expect(resolveMaxConcurrentLeases('none')).toBe(1);
  });

  it('forces sticky affinity to 1 even when pool allows more', () => {
    expect(resolveMaxConcurrentLeases('session', { maxConcurrentPerProxy: 5 })).toBe(
      STICKY_MAX_CONCURRENT_LEASES,
    );
    expect(resolveMaxConcurrentLeases('request', { maxConcurrentPerProxy: 5 })).toBe(1);
  });

  it('reads PROXY_MAX_CONCURRENT_LEASES for stateless acquires', () => {
    process.env.PROXY_MAX_CONCURRENT_LEASES = '3';
    expect(resolveMaxConcurrentLeases('none')).toBe(3);
  });

  it('prefers explicit pool option over env', () => {
    process.env.PROXY_MAX_CONCURRENT_LEASES = '3';
    expect(resolveMaxConcurrentLeases('none', { maxConcurrentPerProxy: 2 })).toBe(2);
  });
});
