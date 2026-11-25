-- Address-based trips (docs/ARCHITECTURE-v2.md section 4). Additive: every
-- existing row keeps its zone-mode meaning, 001_foundation.sql is untouched,
-- and old driver/request inserts keep working through column defaults.

-- One random generation per dataset. Selection signing keys are derived from
-- it, so the guarded reset replaces it in the same transaction that replaces
-- the data. The app role may only read it.
CREATE TABLE dataset_generation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  generation uuid NOT NULL
);
INSERT INTO dataset_generation (generation) VALUES (gen_random_uuid());
GRANT SELECT ON dataset_generation TO groupride_app;

ALTER TABLE trips
  ADD COLUMN location_mode text NOT NULL DEFAULT 'zone'
    CHECK (location_mode IN ('zone', 'address')),
  ADD COLUMN venue_location jsonb,
  ADD CONSTRAINT trip_mode_venue CHECK (
    (location_mode = 'zone' AND venue_location IS NULL)
    OR (location_mode = 'address' AND venue_location IS NOT NULL)
  ),
  ADD CONSTRAINT trip_id_mode UNIQUE (id, location_mode);

ALTER TABLE drivers
  ALTER COLUMN zone_id DROP NOT NULL,
  ADD COLUMN location_mode text NOT NULL DEFAULT 'zone'
    CHECK (location_mode IN ('zone', 'address')),
  ADD COLUMN location jsonb,
  ADD COLUMN max_detour_minutes integer,
  ADD CONSTRAINT driver_mode_fields CHECK (
    (location_mode = 'zone' AND zone_id IS NOT NULL
      AND location IS NULL AND max_detour_minutes IS NULL)
    OR (location_mode = 'address' AND zone_id IS NULL AND location IS NOT NULL
      AND max_detour_minutes BETWEEN 0 AND 120)
  ),
  ADD CONSTRAINT driver_trip_mode
    FOREIGN KEY (trip_id, location_mode) REFERENCES trips (id, location_mode);

ALTER TABLE ride_requests
  ALTER COLUMN zone_id DROP NOT NULL,
  ADD COLUMN location_mode text NOT NULL DEFAULT 'zone'
    CHECK (location_mode IN ('zone', 'address')),
  ADD COLUMN location jsonb,
  ADD CONSTRAINT request_mode_fields CHECK (
    (location_mode = 'zone' AND zone_id IS NOT NULL AND location IS NULL)
    OR (location_mode = 'address' AND zone_id IS NULL AND location IS NOT NULL)
  ),
  ADD CONSTRAINT request_trip_mode
    FOREIGN KEY (trip_id, location_mode) REFERENCES trips (id, location_mode);

-- Preview evidence. The public summary lives in its own small column so
-- dashboard and stored-hit reads never select the private leg evidence.
ALTER TABLE match_previews
  ADD COLUMN cost_unit text NOT NULL DEFAULT 'zone_cost'
    CHECK (cost_unit IN ('zone_cost', 'detour_seconds')),
  ADD COLUMN routing_policy text,
  ADD COLUMN summary jsonb,
  ADD COLUMN evidence jsonb,
  ADD CONSTRAINT preview_unit_fields CHECK (
    (cost_unit = 'zone_cost'
      AND routing_policy IS NULL AND summary IS NULL AND evidence IS NULL)
    OR (cost_unit = 'detour_seconds'
      AND routing_policy IS NOT NULL AND summary IS NOT NULL AND evidence IS NOT NULL)
  );
