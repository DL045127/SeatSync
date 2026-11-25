-- ISSUE-057. A CHECK passes when its expression evaluates to NULL, and
-- `NULL BETWEEN 0 AND 120` is NULL, so 002's driver_mode_fields accepted an
-- address driver with no detour limit (the preview reader then rejected that
-- row). Replace it with the same rule plus an explicit NOT NULL test.
--
-- This is a new migration rather than an edit of 002 so a database that already
-- applied 002 keeps its recorded checksum. Adding the constraint validates every
-- existing row: a database holding an address driver without a limit fails here
-- and needs that row repaired, never silently accepted.
ALTER TABLE drivers DROP CONSTRAINT driver_mode_fields;
ALTER TABLE drivers ADD CONSTRAINT driver_mode_fields CHECK (
  (location_mode = 'zone' AND zone_id IS NOT NULL
    AND location IS NULL AND max_detour_minutes IS NULL)
  OR (location_mode = 'address' AND zone_id IS NULL AND location IS NOT NULL
    AND max_detour_minutes IS NOT NULL AND max_detour_minutes BETWEEN 0 AND 120)
);
