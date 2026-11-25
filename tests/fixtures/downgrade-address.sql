-- Test-only: undo exactly what db/migrations/002_address_trips.sql and
-- 003_address_driver_limit.sql add, so the upgrade test can re-apply the REAL
-- migrations over retained W6-shaped rows.
-- Never run by the application.
ALTER TABLE match_previews
  DROP CONSTRAINT preview_unit_fields,
  DROP COLUMN evidence,
  DROP COLUMN summary,
  DROP COLUMN routing_policy,
  DROP COLUMN cost_unit;

ALTER TABLE ride_requests
  DROP CONSTRAINT request_trip_mode,
  DROP CONSTRAINT request_mode_fields,
  DROP COLUMN location,
  DROP COLUMN location_mode;
ALTER TABLE ride_requests ALTER COLUMN zone_id SET NOT NULL;

ALTER TABLE drivers
  DROP CONSTRAINT driver_trip_mode,
  DROP CONSTRAINT driver_mode_fields,
  DROP COLUMN max_detour_minutes,
  DROP COLUMN location,
  DROP COLUMN location_mode;
ALTER TABLE drivers ALTER COLUMN zone_id SET NOT NULL;

ALTER TABLE trips
  DROP CONSTRAINT trip_id_mode,
  DROP CONSTRAINT trip_mode_venue,
  DROP COLUMN venue_location,
  DROP COLUMN location_mode;

DROP TABLE dataset_generation;
DELETE FROM schema_migrations WHERE name IN ('002_address_trips.sql', '003_address_driver_limit.sql');
