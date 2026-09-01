/** Shared options for in-memory and Postgres proxy pools. */
export interface ProxyPoolOptions {
  /**
   * Max active leases per proxy when `affinity` is omitted or `none`.
   * Sticky (`session` / `request`) always uses 1 regardless of this value.
   * Defaults to `DEFAULT_MAX_CONCURRENT_LEASES_PER_PROXY` (1) unless
   * `PROXY_MAX_CONCURRENT_LEASES` is set in the environment.
   */
  maxConcurrentPerProxy?: number;
}
