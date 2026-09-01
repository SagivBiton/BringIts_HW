-- Static proxy pool (see DESIGN.md §1.1)
CREATE TABLE IF NOT EXISTS proxies (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  geo TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL,
  enabled BOOLEAN NOT NULL
);

CREATE TABLE IF NOT EXISTS proxy_health (
  proxy_id TEXT NOT NULL REFERENCES proxies(id),
  target TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 1,
  consecutive_failures INT NOT NULL DEFAULT 0,
  cooldown_until TIMESTAMPTZ,
  burned_until TIMESTAMPTZ,
  PRIMARY KEY (proxy_id, target)
);

CREATE TABLE IF NOT EXISTS proxy_leases (
  lease_id TEXT PRIMARY KEY,
  proxy_id TEXT NOT NULL REFERENCES proxies(id),
  request_id TEXT NOT NULL,
  target TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Local test egress row
INSERT INTO proxies (id, url, geo, kind, mode, enabled)
VALUES ('local', 'direct', 'US', 'local-test', 'stateless', true)
ON CONFLICT (id) DO NOTHING;
