-- An invitation is a separate capability from the organizer's trip ID.
ALTER TABLE trips ADD COLUMN invite_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
