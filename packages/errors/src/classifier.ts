import {
  ErrorCode,
  ErrorDecision,
  ERROR_HTTP_STATUS,
  ProxyAffinity,
  RetryPolicy,
  ProxyAction,
} from '@llm-query/types';

export type TransportSignal =
  | { kind: 'no_proxy'; explicit_geo: boolean }
  | { kind: 'http_status'; status: number; affinity: ProxyAffinity; retry_after_ms?: number }
  | { kind: 'timeout'; affinity: ProxyAffinity }
  | { kind: 'queue_saturated' }
  | { kind: 'empty_response'; affinity: ProxyAffinity }
  | { kind: 'parse_failed' };

export function classifyTransportFailure(signal: TransportSignal): ErrorDecision {
  switch (signal.kind) {
    case 'no_proxy':
      return decision(
        signal.explicit_geo ? ErrorCode.GEO_UNAVAILABLE : ErrorCode.TARGET_UNAVAILABLE,
        signal.explicit_geo
          ? 'No healthy proxy available for the requested geo.'
          : 'No healthy proxy available in the default pool.',
        'never',
        'none',
        null,
        false,
        `no_proxy:${signal.explicit_geo}`,
      );
    case 'http_status':
      if (signal.status === 429) {
        return decision(
          ErrorCode.TARGET_RATE_LIMITED,
          'Target rate limited the request.',
          signal.affinity === 'none' ? 'new_proxy' : 'same_lease',
          'cooldown',
          signal.retry_after_ms ?? null,
          true,
          'http:429',
        );
      }
      if (signal.status === 403) {
        return decision(
          ErrorCode.TARGET_BLOCKED,
          'The target returned a block or challenge instead of an answer.',
          'new_proxy',
          'cooldown',
          null,
          true,
          'http:403',
        );
      }
      return decision(
        ErrorCode.TARGET_UNAVAILABLE,
        `Target returned HTTP ${signal.status}.`,
        'never',
        'neutral',
        null,
        false,
        `http:${signal.status}`,
      );
    case 'timeout':
      return decision(
        ErrorCode.TARGET_TIMEOUT,
        'The request timed out before an answer was received.',
        'same_lease',
        'neutral',
        null,
        true,
        'timeout',
      );
    case 'queue_saturated':
      return decision(
        ErrorCode.TARGET_UNAVAILABLE,
        'Worker queue did not accept the job before the deadline.',
        'never',
        'none',
        null,
        false,
        'queue_saturated',
      );
    case 'empty_response':
      return decision(
        ErrorCode.EMPTY_RESPONSE,
        'The target finished without assistant text.',
        'same_lease',
        'neutral',
        null,
        true,
        'empty_response',
      );
    case 'parse_failed':
      return decision(
        ErrorCode.PARSING_FAILED,
        'Could not parse the target response into an answer.',
        'never',
        'neutral',
        null,
        false,
        'parse_failed',
      );
  }
}

function decision(
  code: ErrorCode,
  message: string,
  retry: RetryPolicy,
  proxy_action: ProxyAction,
  retry_after_ms: number | null,
  retryable: boolean,
  fingerprint: string,
): ErrorDecision {
  return {
    code,
    message,
    http_status: ERROR_HTTP_STATUS[code],
    retry,
    proxy_action,
    retry_after_ms,
    retryable,
    fingerprint,
  };
}

