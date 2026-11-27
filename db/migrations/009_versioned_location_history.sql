-- Earlier history kept only the last replacement of a given location ID.
-- Start a provable timeline at the current version for existing registrations.
ALTER TABLE drivers ADD COLUMN location_history_since integer NOT NULL DEFAULT 0 CHECK (location_history_since >= 0);
ALTER TABLE ride_requests ADD COLUMN location_history_since integer NOT NULL DEFAULT 0 CHECK (location_history_since >= 0);

UPDATE drivers d SET location_history_since = t.version FROM trips t
WHERE d.trip_id = t.id AND d.location_mode = 'address';
UPDATE ride_requests r SET location_history_since = t.version FROM trips t
WHERE r.trip_id = t.id AND r.location_mode = 'address';

ALTER TABLE participant_location_history
  DROP CONSTRAINT participant_location_history_pkey,
  ADD PRIMARY KEY (trip_id, participant_kind, participant_id, replaced_at_version);
REVOKE UPDATE ON participant_location_history FROM groupride_app;
