// SQL repositories. Every function receives a transaction client (the trip
// service owns all writes). Statements are parameterized. These do not decide
// business policy; the service does.

import type { PoolClient } from "pg";

export interface TripRow {
  id: string;
  name: string;
  destination_label: string;
  depart_at: string;
  status: "open" | "assigned" | "needs_rematch";
  version: number;
  plan_version: number | null;
  committed_preview_id: string | null;
  algorithm_version: string | null;
  committed_at: string | null;
}

export interface DriverRow {
  id: string;
  trip_id: string;
  zone_id: string;
  name: string;
  seat_capacity: number;
  active: boolean;
}

export interface RequestRow {
  id: string;
  trip_id: string;
  zone_id: string;
  name: string;
  active: boolean;
}

/** Lock the trip row FOR UPDATE; returns undefined when the trip does not exist. */
export async function lockTrip(
  client: PoolClient,
  tripId: string,
): Promise<TripRow | undefined> {
  const result = await client.query<TripRow>(
    `SELECT id, name, destination_label, depart_at, status, version,
            plan_version, committed_preview_id, algorithm_version, committed_at
       FROM trips WHERE id = $1 FOR UPDATE`,
    [tripId],
  );
  return result.rows[0];
}

/** Read a trip without locking (for consistent read snapshots). */
export async function readTrip(
  client: PoolClient,
  tripId: string,
): Promise<TripRow | undefined> {
  const result = await client.query<TripRow>(
    `SELECT id, name, destination_label, depart_at, status, version,
            plan_version, committed_preview_id, algorithm_version, committed_at
       FROM trips WHERE id = $1`,
    [tripId],
  );
  return result.rows[0];
}

export async function insertTrip(
  client: PoolClient,
  trip: { name: string; destinationLabel: string; departAt: string },
): Promise<TripRow> {
  const result = await client.query<TripRow>(
    `INSERT INTO trips (name, destination_label, depart_at)
     VALUES ($1, $2, $3)
     RETURNING id, name, destination_label, depart_at, status, version,
               plan_version, committed_preview_id, algorithm_version, committed_at`,
    [trip.name, trip.destinationLabel, trip.departAt],
  );
  return result.rows[0];
}

export async function countDrivers(client: PoolClient, tripId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM drivers WHERE trip_id = $1",
    [tripId],
  );
  return Number(result.rows[0].count);
}

export async function countRequests(client: PoolClient, tripId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM ride_requests WHERE trip_id = $1",
    [tripId],
  );
  return Number(result.rows[0].count);
}

export async function insertDriver(
  client: PoolClient,
  driver: { tripId: string; zoneId: string; name: string; seatCapacity: number },
): Promise<DriverRow> {
  const result = await client.query<DriverRow>(
    `INSERT INTO drivers (trip_id, zone_id, name, seat_capacity)
     VALUES ($1, $2, $3, $4)
     RETURNING id, trip_id, zone_id, name, seat_capacity, active`,
    [driver.tripId, driver.zoneId, driver.name, driver.seatCapacity],
  );
  return result.rows[0];
}

export async function insertRequest(
  client: PoolClient,
  request: { tripId: string; zoneId: string; name: string },
): Promise<RequestRow> {
  const result = await client.query<RequestRow>(
    `INSERT INTO ride_requests (trip_id, zone_id, name)
     VALUES ($1, $2, $3)
     RETURNING id, trip_id, zone_id, name, active`,
    [request.tripId, request.zoneId, request.name],
  );
  return result.rows[0];
}

export async function findDriver(
  client: PoolClient,
  tripId: string,
  driverId: string,
): Promise<DriverRow | undefined> {
  const result = await client.query<DriverRow>(
    `SELECT id, trip_id, zone_id, name, seat_capacity, active
       FROM drivers WHERE trip_id = $1 AND id = $2`,
    [tripId, driverId],
  );
  return result.rows[0];
}

export async function findRequest(
  client: PoolClient,
  tripId: string,
  requestId: string,
): Promise<RequestRow | undefined> {
  const result = await client.query<RequestRow>(
    `SELECT id, trip_id, zone_id, name, active
       FROM ride_requests WHERE trip_id = $1 AND id = $2`,
    [tripId, requestId],
  );
  return result.rows[0];
}

export async function updateDriverCapacity(
  client: PoolClient,
  tripId: string,
  driverId: string,
  seatCapacity: number,
): Promise<void> {
  await client.query(
    "UPDATE drivers SET seat_capacity = $3 WHERE trip_id = $1 AND id = $2",
    [tripId, driverId, seatCapacity],
  );
}

export async function cancelDriver(
  client: PoolClient,
  tripId: string,
  driverId: string,
): Promise<void> {
  await client.query(
    "UPDATE drivers SET active = false WHERE trip_id = $1 AND id = $2",
    [tripId, driverId],
  );
}

export async function withdrawRequestRow(
  client: PoolClient,
  tripId: string,
  requestId: string,
): Promise<void> {
  await client.query(
    "UPDATE ride_requests SET active = false WHERE trip_id = $1 AND id = $2",
    [tripId, requestId],
  );
}

/** Bump the trip version by one while open. Keeps status unchanged. */
export async function bumpVersionOpen(
  client: PoolClient,
  tripId: string,
): Promise<number> {
  const result = await client.query<{ version: number }>(
    "UPDATE trips SET version = version + 1 WHERE id = $1 RETURNING version",
    [tripId],
  );
  return result.rows[0].version;
}

/**
 * Apply whole-plan invalidation for an effective roster change on an assigned or
 * needs_rematch trip: delete all assignments, clear plan metadata, bump version,
 * and set needs_rematch. Returns the new version.
 */
export async function invalidatePlanAndBump(
  client: PoolClient,
  tripId: string,
): Promise<number> {
  await client.query("DELETE FROM assignments WHERE trip_id = $1", [tripId]);
  const result = await client.query<{ version: number }>(
    `UPDATE trips
       SET version = version + 1,
           status = 'needs_rematch',
           plan_version = NULL,
           committed_preview_id = NULL,
           algorithm_version = NULL,
           committed_at = NULL
     WHERE id = $1
     RETURNING version`,
    [tripId],
  );
  return result.rows[0].version;
}

export async function listDrivers(
  client: PoolClient,
  tripId: string,
): Promise<DriverRow[]> {
  const result = await client.query<DriverRow>(
    `SELECT id, trip_id, zone_id, name, seat_capacity, active
       FROM drivers WHERE trip_id = $1 ORDER BY created_at, id`,
    [tripId],
  );
  return result.rows;
}

export async function listRequests(
  client: PoolClient,
  tripId: string,
): Promise<RequestRow[]> {
  const result = await client.query<RequestRow>(
    `SELECT id, trip_id, zone_id, name, active
       FROM ride_requests WHERE trip_id = $1 ORDER BY created_at, id`,
    [tripId],
  );
  return result.rows;
}

export interface AssignmentRow {
  trip_id: string;
  request_id: string;
  driver_id: string;
  pickup_cost: number;
  committed_version: number;
}

export async function listAssignments(
  client: PoolClient,
  tripId: string,
): Promise<AssignmentRow[]> {
  const result = await client.query<AssignmentRow>(
    `SELECT trip_id, request_id, driver_id, pickup_cost, committed_version
       FROM assignments WHERE trip_id = $1 ORDER BY request_id`,
    [tripId],
  );
  return result.rows;
}

export interface ZoneCostRow {
  driver_zone_id: string;
  passenger_zone_id: string;
  cost: number;
}

export async function listZoneCosts(client: PoolClient): Promise<ZoneCostRow[]> {
  const result = await client.query<ZoneCostRow>(
    "SELECT driver_zone_id, passenger_zone_id, cost FROM zone_costs",
  );
  return result.rows;
}

export interface PreviewRow {
  id: string;
  trip_id: string;
  base_version: number;
  algorithm_version: string;
  optimal_result: unknown;
  greedy_result: unknown;
}

/** Find an immutable preview by its unique (trip, version, algorithm) key. */
export async function findPreviewByKey(
  client: PoolClient,
  tripId: string,
  baseVersion: number,
  algorithmVersion: string,
): Promise<PreviewRow | undefined> {
  const result = await client.query<PreviewRow>(
    `SELECT id, trip_id, base_version, algorithm_version, optimal_result, greedy_result
       FROM match_previews
      WHERE trip_id = $1 AND base_version = $2 AND algorithm_version = $3`,
    [tripId, baseVersion, algorithmVersion],
  );
  return result.rows[0];
}

/** Find a preview by its id within a trip. */
export async function findPreviewById(
  client: PoolClient,
  tripId: string,
  previewId: string,
): Promise<PreviewRow | undefined> {
  const result = await client.query<PreviewRow>(
    `SELECT id, trip_id, base_version, algorithm_version, optimal_result, greedy_result
       FROM match_previews WHERE trip_id = $1 AND id = $2`,
    [tripId, previewId],
  );
  return result.rows[0];
}

export async function insertPreview(
  client: PoolClient,
  preview: {
    tripId: string;
    baseVersion: number;
    algorithmVersion: string;
    optimalResult: unknown;
    greedyResult: unknown;
  },
): Promise<PreviewRow> {
  const result = await client.query<PreviewRow>(
    `INSERT INTO match_previews
       (trip_id, base_version, algorithm_version, optimal_result, greedy_result)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
     RETURNING id, trip_id, base_version, algorithm_version, optimal_result, greedy_result`,
    [
      preview.tripId,
      preview.baseVersion,
      preview.algorithmVersion,
      JSON.stringify(preview.optimalResult),
      JSON.stringify(preview.greedyResult),
    ],
  );
  return result.rows[0];
}

/**
 * Atomically replace the committed plan: delete existing assignments, insert the
 * new ones at `committedVersion`, then set the trip to `assigned` with plan
 * metadata and the incremented version.
 */
export async function commitPlan(
  client: PoolClient,
  params: {
    tripId: string;
    previewId: string;
    algorithmVersion: string;
    committedVersion: number;
    assignments: Array<{ requestId: string; driverId: string; pickupCost: number }>;
  },
): Promise<void> {
  await client.query("DELETE FROM assignments WHERE trip_id = $1", [params.tripId]);
  for (const a of params.assignments) {
    await client.query(
      `INSERT INTO assignments (trip_id, request_id, driver_id, pickup_cost, committed_version)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.tripId, a.requestId, a.driverId, a.pickupCost, params.committedVersion],
    );
  }
  await client.query(
    `UPDATE trips
        SET version = $2,
            status = 'assigned',
            plan_version = $2,
            committed_preview_id = $3,
            algorithm_version = $4,
            committed_at = now()
      WHERE id = $1`,
    [params.tripId, params.committedVersion, params.previewId, params.algorithmVersion],
  );
}
