import { parseRetryAfterMs } from '../src/retry-after';

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterMs('7')).toBe(7000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('returns undefined for missing/invalid', () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    expect(parseRetryAfterMs('nope')).toBeUndefined();
  });

  it('parses HTTP-date into a future delta', () => {
    const ms = parseRetryAfterMs(new Date(Date.now() + 5000).toUTCString());
    expect(ms).toBeGreaterThan(0);
    expect(ms!).toBeLessThanOrEqual(5000);
  });
});
