-- VatIRIS: EFS scribble sync storage
-- Run against the VatIRIS Postgres database.

CREATE TABLE IF NOT EXISTS efs_scribble (
  realm TEXT NOT NULL,
  airport TEXT NOT NULL,
  strip_key TEXT NOT NULL,
  strokes JSONB NOT NULL DEFAULT '[]'::jsonb,
  strip_meta JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_cid BIGINT,
  PRIMARY KEY (realm, airport, strip_key)
);

CREATE INDEX IF NOT EXISTS efs_scribble_room_updated_idx
  ON efs_scribble (realm, airport, updated_at);

-- Optional: purge rows older than 1h via cron / scheduled job:
-- DELETE FROM efs_scribble WHERE updated_at < NOW() - INTERVAL '1 hour';
