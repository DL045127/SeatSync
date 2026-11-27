-- Test-only: undo migrations 002 through 007 so the upgrade test can re-apply the
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
  DROP COLUMN location_mode,
  DROP COLUMN guest_leave_hash;
ALTER TABLE ride_requests ALTER COLUMN zone_id SET NOT NULL;

ALTER TABLE drivers
  DROP CONSTRAINT driver_trip_mode,
  DROP CONSTRAINT driver_mode_fields,
  DROP COLUMN max_detour_minutes,
  DROP COLUMN location,
  DROP COLUMN location_mode,
  DROP COLUMN guest_leave_hash;
ALTER TABLE drivers ALTER COLUMN zone_id SET NOT NULL;

ALTER TABLE trips
  DROP CONSTRAINT trip_id_mode,
  DROP CONSTRAINT trip_mode_venue,
  DROP COLUMN venue_location,
  DROP COLUMN location_mode,
  DROP COLUMN invite_id,
  DROP COLUMN workspace_id;

DROP TABLE travel_times, saved_places, place_passes, workspace_sessions, workspaces;

DROP TABLE dataset_generation;
DELETE FROM schema_migrations WHERE name IN ('002_address_trips.sql', '003_address_driver_limit.sql', '004_trip_invites.sql', '005_guest_leave.sql', '006_reuse.sql', '007_workspace_recovery_version.sql');
