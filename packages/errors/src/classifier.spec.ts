import { classifyTransportFailure } from '../src/classifier';
import { ErrorCode } from '@llm-query/types';

describe('classifyTransportFailure', () => {
  it('maps explicit geo miss to GEO_UNAVAILABLE', () => {
    const decision = classifyTransportFailure({
      kind: 'no_proxy',
      explicit_geo: true,
    });
    expect(decision.code).toBe(ErrorCode.GEO_UNAVAILABLE);
    expect(decision.retry).toBe('never');
    expect(decision.proxy_action).toBe('none');
    expect(decision.retryable).toBe(false);
  });

  it('maps empty default pool to TARGET_UNAVAILABLE', () => {
    const decision = classifyTransportFailure({
      kind: 'no_proxy',
      explicit_geo: false,
    });
    expect(decision.code).toBe(ErrorCode.TARGET_UNAVAILABLE);
  });

  it('maps HTTP 429 to rate limited with cooldown and new_proxy', () => {
    const decision = classifyTransportFailure({
      kind: 'http_status',
      status: 429,
      affinity: 'none',
      retry_after_ms: 5000,
    });
    expect(decision.code).toBe(ErrorCode.TARGET_RATE_LIMITED);
    expect(decision.http_status).toBe(429);
    expect(decision.retry).toBe('new_proxy');
    expect(decision.proxy_action).toBe('cooldown');
    expect(decision.retry_after_ms).toBe(5000);
    expect(decision.retryable).toBe(true);
  });

  it('maps HTTP 429 with session affinity to same_lease', () => {
    const decision = classifyTransportFailure({
      kind: 'http_status',
      status: 429,
      affinity: 'session',
    });
    expect(decision.code).toBe(ErrorCode.TARGET_RATE_LIMITED);
    expect(decision.retry).toBe('same_lease');
    expect(decision.proxy_action).toBe('cooldown');
  });

  it('maps HTTP 403 to blocked with cooldown', () => {
    const decision = classifyTransportFailure({
      kind: 'http_status',
      status: 403,
      affinity: 'none',
    });
    expect(decision.code).toBe(ErrorCode.TARGET_BLOCKED);
    expect(decision.proxy_action).toBe('cooldown');
    expect(decision.retry).toBe('new_proxy');
  });

  it('maps other HTTP 5xx to TARGET_UNAVAILABLE with neutral proxy action', () => {
    const decision = classifyTransportFailure({
      kind: 'http_status',
      status: 503,
      affinity: 'none',
    });
    expect(decision.code).toBe(ErrorCode.TARGET_UNAVAILABLE);
    expect(decision.http_status).toBe(503);
    expect(decision.proxy_action).toBe('neutral');
    expect(decision.retry).toBe('never');
  });

  it('maps timeout to TARGET_TIMEOUT with same_lease retry once', () => {
    const decision = classifyTransportFailure({
      kind: 'timeout',
      affinity: 'none',
    });
    expect(decision.code).toBe(ErrorCode.TARGET_TIMEOUT);
    expect(decision.retry).toBe('same_lease');
    expect(decision.proxy_action).toBe('neutral');
  });

  it('maps queue deadline to TARGET_UNAVAILABLE', () => {
    const decision = classifyTransportFailure({ kind: 'queue_saturated' });
    expect(decision.code).toBe(ErrorCode.TARGET_UNAVAILABLE);
    expect(decision.retry).toBe('never');
  });
});
