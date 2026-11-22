CREATE TABLE zones (
  id text PRIMARY KEY,
  label text NOT NULL CHECK (label <> '')
);

CREATE TABLE zone_costs (
  driver_zone_id text REFERENCES zones(id),
  passenger_zone_id text REFERENCES zones(id),
  cost integer NOT NULL CHECK (cost BETWEEN 0 AND 10000),
  PRIMARY KEY (driver_zone_id, passenger_zone_id)
);

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  destination_label text NOT NULL CHECK (char_length(destination_label) BETWEEN 1 AND 120),
  depart_at timestamptz(3) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'needs_rematch')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  plan_version integer,
  committed_preview_id uuid,
  algorithm_version text,
  committed_at timestamptz,
  CONSTRAINT trip_plan_state CHECK (
    (status = 'assigned' AND plan_version IS NOT NULL AND plan_version = version
      AND committed_preview_id IS NOT NULL AND algorithm_version IS NOT NULL
      AND committed_at IS NOT NULL)
    OR (status <> 'assigned' AND plan_version IS NULL AND committed_preview_id IS NULL
      AND algorithm_version IS NULL AND committed_at IS NULL)
  )
);

CREATE TABLE drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  zone_id text NOT NULL REFERENCES zones(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  seat_capacity integer NOT NULL CHECK (seat_capacity BETWEEN 0 AND 8),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, id)
);

CREATE TABLE ride_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  zone_id text NOT NULL REFERENCES zones(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, id)
);

CREATE TABLE match_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  base_version integer NOT NULL CHECK (base_version >= 0),
  algorithm_version text NOT NULL,
  optimal_result jsonb NOT NULL,
  greedy_result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, base_version, algorithm_version),
  UNIQUE (trip_id, id)
);

ALTER TABLE trips ADD CONSTRAINT trip_committed_preview
  FOREIGN KEY (id, committed_preview_id) REFERENCES match_previews(trip_id, id);

CREATE TABLE assignments (
  trip_id uuid NOT NULL,
  request_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  pickup_cost integer NOT NULL CHECK (pickup_cost BETWEEN 0 AND 10000),
  committed_version integer NOT NULL CHECK (committed_version > 0),
  PRIMARY KEY (trip_id, request_id),
  FOREIGN KEY (trip_id, request_id) REFERENCES ride_requests(trip_id, id) ON DELETE CASCADE,
  FOREIGN KEY (trip_id, driver_id) REFERENCES drivers(trip_id, id) ON DELETE CASCADE
);

CREATE TABLE mutation_receipts (
  request_key uuid PRIMARY KEY,
  request_fingerprint text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied', 'not_applied')),
  http_status integer NOT NULL CHECK (
    (outcome = 'applied' AND http_status BETWEEN 200 AND 299)
    OR (outcome = 'not_applied' AND http_status BETWEEN 400 AND 599)
  ),
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX drivers_trip_active ON drivers (trip_id, active);
CREATE INDEX ride_requests_trip_active ON ride_requests (trip_id, active);
CREATE INDEX assignments_trip_driver ON assignments (trip_id, driver_id);

GRANT SELECT ON zones, zone_costs TO groupride_app;
GRANT SELECT, INSERT, UPDATE ON trips, drivers, ride_requests TO groupride_app;
GRANT SELECT, INSERT ON match_previews, mutation_receipts TO groupride_app;
GRANT SELECT, INSERT, DELETE ON assignments TO groupride_app;
