CREATE TABLE workspaces (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recovery_hash text        UNIQUE,                 -- NULL until a code is issued
  last_used_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE workspace_sessions (
  secret_hash  text        PRIMARY KEY,
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  last_used_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE trips ADD COLUMN workspace_id uuid REFERENCES workspaces (id) ON DELETE SET NULL;

CREATE TABLE travel_times (           -- A. coordinates only; never returned by any API
  workspace_id   uuid             NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  routing_policy text             NOT NULL,
  from_point     text             NOT NULL,   -- exported coordinateKey(): JSON.stringify([lon, lat])
  to_point       text             NOT NULL,
  seconds        double precision NOT NULL CHECK (seconds >= 0 AND seconds <= 1000000),  -- the evidence validator's ceiling
  observed_at    timestamptz      NOT NULL,
  PRIMARY KEY (workspace_id, routing_policy, from_point, to_point),
  CHECK (from_point <> to_point)
);
CREATE INDEX travel_times_observed ON travel_times (observed_at);

CREATE TABLE saved_places (           -- C. owner-entered places only
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  provider     text        NOT NULL CHECK (provider IN ('fixture', 'geoapify')),
  kind         text        NOT NULL CHECK (kind IN ('venue', 'participant')),
  point_key    text        NOT NULL,
  snapshot     jsonb       NOT NULL,        -- snapshotBodySchema
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider, kind, point_key, snapshot)
);

CREATE TABLE place_passes (           -- D. browser-generated secret; hash only
  pass_hash    text        PRIMARY KEY,
  provider     text        NOT NULL CHECK (provider IN ('fixture', 'geoapify')),
  snapshot     jsonb       NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON workspaces, workspace_sessions, travel_times, saved_places, place_passes TO groupride_app;
