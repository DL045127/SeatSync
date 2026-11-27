-- Preserve immutable endpoint identities for validation after a roster edit.
CREATE TABLE participant_location_history (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  participant_kind text NOT NULL CHECK (participant_kind IN ('driver', 'passenger')),
  participant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  location jsonb NOT NULL,
  replaced_at_version integer NOT NULL CHECK (replaced_at_version > 0),
  PRIMARY KEY (trip_id, participant_kind, participant_id, location_id)
);
GRANT SELECT, INSERT, UPDATE ON participant_location_history TO groupride_app;
