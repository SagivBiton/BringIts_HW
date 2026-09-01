import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';

/** Gemini Set-Cookie / app bootstrap headers can exceed undici's 16KiB default. */
const MAX_HEADER_SIZE = 262_144;

const directAgent = new Agent({ maxHeaderSize: MAX_HEADER_SIZE });

function wrapUndiciFetch(dispatcher: Agent | ProxyAgent): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as object),
      dispatcher,
    })) as typeof fetch;
}

const directFetch = wrapUndiciFetch(directAgent);

/** True when egress should skip an HTTP proxy (local-test / explicit direct). */
export function isDirectProxyUrl(proxyUrl: string): boolean {
  if (!proxyUrl || proxyUrl === 'direct') return true;
  try {
    const url = new URL(proxyUrl);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return true;
  } catch {
    return false;
  }
  return false;
}

/**
 * Fetch that routes through an HTTP proxy when `proxyUrl` is a real proxy.
 * Always uses undici with a raised `maxHeaderSize` (Gemini cookie headers).
 */
export function createProxiedFetch(proxyUrl: string): typeof fetch {
  if (isDirectProxyUrl(proxyUrl)) {
    return directFetch;
  }
  return wrapUndiciFetch(
    new ProxyAgent({ uri: proxyUrl, maxHeaderSize: MAX_HEADER_SIZE }),
  );
}
