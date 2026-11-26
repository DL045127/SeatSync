-- Only invite registrations receive a private, per-participant capability.
ALTER TABLE drivers ADD COLUMN guest_leave_hash text UNIQUE;
ALTER TABLE ride_requests ADD COLUMN guest_leave_hash text UNIQUE;
