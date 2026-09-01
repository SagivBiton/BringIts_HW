export enum ErrorCode {
  INVALID_REQUEST = 'INVALID_REQUEST',
  UNSUPPORTED_SOURCE = 'UNSUPPORTED_SOURCE',
  GEO_UNAVAILABLE = 'GEO_UNAVAILABLE',
  CONVERSATION_NOT_FOUND = 'CONVERSATION_NOT_FOUND',
  TARGET_RATE_LIMITED = 'TARGET_RATE_LIMITED',
  TARGET_BLOCKED = 'TARGET_BLOCKED',
  TARGET_TIMEOUT = 'TARGET_TIMEOUT',
  TARGET_UNAVAILABLE = 'TARGET_UNAVAILABLE',
  PARSING_FAILED = 'PARSING_FAILED',
  EMPTY_RESPONSE = 'EMPTY_RESPONSE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface PublicError {
  code: ErrorCode;
  message: string;
  http_status: number;
  retryable: boolean;
  retry_after_ms: number | null;
}

export interface ValidationError {
  code: ErrorCode.INVALID_REQUEST | ErrorCode.UNSUPPORTED_SOURCE;
  message: string;
  http_status: number;
}

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.INVALID_REQUEST]: 400,
  [ErrorCode.UNSUPPORTED_SOURCE]: 400,
  [ErrorCode.GEO_UNAVAILABLE]: 422,
  [ErrorCode.CONVERSATION_NOT_FOUND]: 404,
  [ErrorCode.TARGET_RATE_LIMITED]: 429,
  [ErrorCode.TARGET_BLOCKED]: 403,
  [ErrorCode.TARGET_TIMEOUT]: 504,
  [ErrorCode.TARGET_UNAVAILABLE]: 503,
  [ErrorCode.PARSING_FAILED]: 502,
  [ErrorCode.EMPTY_RESPONSE]: 502,
  [ErrorCode.INTERNAL_ERROR]: 500,
};
