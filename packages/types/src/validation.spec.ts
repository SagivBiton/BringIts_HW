import {
  validateQueryCommand,
  MAX_PROMPT_LENGTH,
  SUPPORTED_SOURCES,
  ErrorCode,
} from '../src/index';

describe('validateQueryCommand', () => {
  it('accepts a valid gemini request with defaults', () => {
    const result = validateQueryCommand({
      source: 'gemini',
      prompt: 'hello',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parse).toBe(true);
      expect(result.value.geo_location).toBeUndefined();
    }
  });

  it('accepts chatgpt with explicit parse and geo', () => {
    const result = validateQueryCommand({
      source: 'chatgpt',
      prompt: 'hello',
      parse: false,
      geo_location: 'US',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.parse).toBe(false);
      expect(result.value.geo_location).toBe('US');
    }
  });

  it('rejects empty prompt with INVALID_REQUEST', () => {
    const result = validateQueryCommand({ source: 'gemini', prompt: '' });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: ErrorCode.INVALID_REQUEST }),
    });
  });

  it('rejects prompt over max length', () => {
    const result = validateQueryCommand({
      source: 'gemini',
      prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1),
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: ErrorCode.INVALID_REQUEST }),
    });
  });

  it('rejects unsupported source with UNSUPPORTED_SOURCE', () => {
    const result = validateQueryCommand({
      source: 'claude',
      prompt: 'hi',
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: ErrorCode.UNSUPPORTED_SOURCE }),
    });
  });

  it('rejects invalid geo format', () => {
    const result = validateQueryCommand({
      source: 'gemini',
      prompt: 'hi',
      geo_location: 'usa',
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: ErrorCode.INVALID_REQUEST }),
    });
  });

  it('accepts optional conversation_id', () => {
    const result = validateQueryCommand({
      source: 'gemini',
      prompt: 'follow up',
      conversation_id: 'conv_abc',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.conversation_id).toBe('conv_abc');
    }
  });

  it('rejects empty conversation_id', () => {
    const result = validateQueryCommand({
      source: 'gemini',
      prompt: 'hi',
      conversation_id: '',
    });
    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: ErrorCode.INVALID_REQUEST }),
    });
  });

  it('only allows known sources', () => {
    expect(SUPPORTED_SOURCES).toEqual(['chatgpt', 'gemini']);
  });
});
