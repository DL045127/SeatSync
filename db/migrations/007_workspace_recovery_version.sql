-- Order recovery-code rotations by their database commit, independent of HTTP reply order.
ALTER TABLE workspaces
  ADD COLUMN recovery_version integer NOT NULL DEFAULT 0 CHECK (recovery_version >= 0);
