import {
  DEFAULT_PARSE,
  MAX_PROMPT_LENGTH,
  QueryCommand,
  SUPPORTED_SOURCES,
  SourceId,
} from './index';
import { ErrorCode, ERROR_HTTP_STATUS, ValidationError } from './errors';

export type ValidationResult =
  | { ok: true; value: QueryCommand }
  | { ok: false; error: ValidationError };

const ISO_GEO = /^[A-Z]{2}$/;

export function validateQueryCommand(
  body: Record<string, unknown>,
): ValidationResult {
  const source = body.source;
  if (typeof source !== 'string') {
    return invalid('source is required');
  }
  if (!SUPPORTED_SOURCES.includes(source as SourceId)) {
    return {
      ok: false,
      error: {
        code: ErrorCode.UNSUPPORTED_SOURCE,
        message: `Unsupported source: ${source}`,
        http_status: ERROR_HTTP_STATUS[ErrorCode.UNSUPPORTED_SOURCE],
      },
    };
  }

  const prompt = body.prompt;
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return invalid('prompt must be a non-empty string');
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return invalid(`prompt exceeds maximum length of ${MAX_PROMPT_LENGTH}`);
  }

  const parse =
    body.parse === undefined ? DEFAULT_PARSE : Boolean(body.parse);

  let geo_location: string | undefined;
  if (body.geo_location !== undefined) {
    if (typeof body.geo_location !== 'string' || !ISO_GEO.test(body.geo_location)) {
      return invalid('geo_location must be ISO 3166-1 alpha-2 (e.g. US)');
    }
    geo_location = body.geo_location;
  }

  let conversation_id: string | undefined;
  if (body.conversation_id !== undefined) {
    if (typeof body.conversation_id !== 'string' || body.conversation_id.trim().length === 0) {
      return invalid('conversation_id must be a non-empty string when provided');
    }
    conversation_id = body.conversation_id;
  }

  return {
    ok: true,
    value: {
      source: source as SourceId,
      prompt,
      parse,
      geo_location,
      conversation_id,
    },
  };
}

function invalid(message: string): ValidationResult {
  return {
    ok: false,
    error: {
      code: ErrorCode.INVALID_REQUEST,
      message,
      http_status: ERROR_HTTP_STATUS[ErrorCode.INVALID_REQUEST],
    },
  };
}
