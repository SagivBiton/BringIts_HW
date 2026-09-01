import { createProxiedFetch, isDirectProxyUrl } from '../src/proxied-fetch';

describe('isDirectProxyUrl', () => {
  it('treats empty, direct, and local-test placeholders as direct', () => {
    expect(isDirectProxyUrl('')).toBe(true);
    expect(isDirectProxyUrl('direct')).toBe(true);
    expect(isDirectProxyUrl('http://127.0.0.1:8080')).toBe(true);
    expect(isDirectProxyUrl('http://localhost:8080')).toBe(true);
  });

  it('treats real proxy URLs as not direct', () => {
    expect(isDirectProxyUrl('http://user:pass@proxy.example:8080')).toBe(false);
    expect(isDirectProxyUrl('http://10.0.0.5:3128')).toBe(false);
  });
});

describe('createProxiedFetch', () => {
  it('returns an undici-backed fetch for direct egress (raised maxHeaderSize)', () => {
    const direct = createProxiedFetch('direct');
    expect(typeof direct).toBe('function');
    expect(direct).not.toBe(fetch);
    expect(createProxiedFetch('')).toBe(direct);
  });

  it('returns a distinct fetch wrapper for real proxies', () => {
    const proxied = createProxiedFetch('http://proxy.example:8080');
    expect(typeof proxied).toBe('function');
    expect(proxied).not.toBe(fetch);
    expect(proxied).not.toBe(createProxiedFetch('direct'));
  });
});
