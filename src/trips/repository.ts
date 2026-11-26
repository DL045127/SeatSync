// SQL repositories. Every function receives a transaction client (the trip
// service owns all writes). Statements are parameterized. These do not decide
// business policy; the service does.

import type { PoolClient } from "pg";

// Test-only barrier fired inside commitPlan AFTER the assignment DELETE and
// BEFORE the INSERT loop (C-05). The W4 suite throws a terminal failure here to
// prove the savepoint rollback restores the deleted plan rather than leaving
// the trip with no assignments. Production never sets it.
let commitPlanMidHook: (() => Promise<void>) | undefined;
export function __setCommitPlanMidHook(hook: (() => Promise<void>) | undefined): void {
  commitPlanMidHook = hook;
}

export type LocationMode = "zone" | "address";

export interface TripRow {
  id: string;
  invite_id: string;
  name: string;
  destination_label: string;
  depart_at: string;
  status: "open" | "assigned" | "needs_rematch";
  version: number;
  plan_version: number | null;
  committed_preview_id: string | null;
  algorithm_version: string | null;
  committed_at: string | null;
  location_mode: LocationMode;
  /** The venue snapshot of an address trip; null for a zone trip. */
  venue_location: unknown;
}

export interface DriverRow {
  id: string;
  trip_id: string;
  zone_id: string | null;
  name: string;
  seat_capacity: number;
  active: boolean;
  location_mode: LocationMode;
  location: unknown;
  max_detour_minutes: number | null;
}

export interface RequestRow {
  id: string;
  trip_id: string;
  zone_id: string | null;
  name: string;
  active: boolean;
  location_mode: LocationMode;
  location: unknown;
}

const TRIP_COLUMNS = `id, invite_id, name, destination_label, depart_at, status, version,
            plan_version, committed_preview_id, algorithm_version, committed_at,
            location_mode, venue_location`;
const DRIVER_COLUMNS = `id, trip_id, zone_id, name, seat_capacity, active,
            location_mode, location, max_detour_minutes`;
const REQUEST_COLUMNS = "id, trip_id, zone_id, name, active, location_mode, location";

/** Lock the trip row FOR UPDATE; returns undefined when the trip does not exist. */
export async function lockTrip(
  client: PoolClient,
  tripId: string,
  byInvite = false,
): Promise<TripRow | undefined> {
  const result = await client.query<TripRow>(
    `SELECT ${TRIP_COLUMNS} FROM trips WHERE ${byInvite ? "invite_id" : "id"} = $1 FOR UPDATE`,
    [tripId],
  );
  return result.rows[0];
}

/** Read a trip without locking (for consistent read snapshots). */
export async function readTrip(
  client: PoolClient,
  tripId: string,
  byInvite = false,
): Promise<TripRow | undefined> {
  const result = await client.query<TripRow>(
    `SELECT ${TRIP_COLUMNS} FROM trips WHERE ${byInvite ? "invite_id" : "id"} = $1`,
    [tripId],
  );
  return result.rows[0];
}

export async function insertTrip(
  client: PoolClient,
  trip: {
    name: string;
    destinationLabel: string;
    departAt: string;
    /** Set for an address trip: the immutable venue snapshot. */
    venueLocation?: unknown;
  },
): Promise<TripRow> {
  const address = trip.venueLocation !== undefined;
  const result = await client.query<TripRow>(
    `INSERT INTO trips (name, destination_label, depart_at, location_mode, venue_location)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING ${TRIP_COLUMNS}`,
    [
      trip.name,
      trip.destinationLabel,
      trip.departAt,
      address ? "address" : "zone",
      address ? JSON.stringify(trip.venueLocation) : null,
    ],
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

/** Insert a driver in the trip's mode: a zone ID, or an address snapshot with its detour limit. */
export async function insertDriver(
  client: PoolClient,
  driver:
    (
    | { tripId: string; zoneId: string; name: string; seatCapacity: number }
    | { tripId: string; location: unknown; maxDetourMinutes: number; name: string; seatCapacity: number }) & { guestLeaveHash?: string },
): Promise<DriverRow> {
  const address = "location" in driver;
  const result = await client.query<DriverRow>(
    `INSERT INTO drivers (trip_id, zone_id, name, seat_capacity, location_mode, location, max_detour_minutes, guest_leave_hash)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING ${DRIVER_COLUMNS}`,
    [
      driver.tripId,
      address ? null : driver.zoneId,
      driver.name,
      driver.seatCapacity,
      address ? "address" : "zone",
      address ? JSON.stringify(driver.location) : null,
      address ? driver.maxDetourMinutes : null,
      driver.guestLeaveHash,
    ],
  );
  return result.rows[0];
}

export async function insertRequest(
  client: PoolClient,
  request:
    (
    | { tripId: string; zoneId: string; name: string }
    | { tripId: string; location: unknown; name: string }) & { guestLeaveHash?: string },
): Promise<RequestRow> {
  const address = "location" in request;
  const result = await client.query<RequestRow>(
    `INSERT INTO ride_requests (trip_id, zone_id, name, location_mode, location, guest_leave_hash)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     RETURNING ${REQUEST_COLUMNS}`,
    [
      request.tripId,
      address ? null : request.zoneId,
      request.name,
      address ? "address" : "zone",
      address ? JSON.stringify(request.location) : null,
      request.guestLeaveHash,
    ],
  );
  return result.rows[0];
}

export async function findDriver(
  client: PoolClient,
  tripId: string,
  driverId: string,
): Promise<DriverRow | undefined> {
  const result = await client.query<DriverRow>(
    `SELECT ${DRIVER_COLUMNS} FROM drivers WHERE trip_id = $1 AND id = $2`,
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
    `SELECT ${REQUEST_COLUMNS} FROM ride_requests WHERE trip_id = $1 AND id = $2`,
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

type ParticipantDetailsUpdate = { name: string; zoneId?: string; location?: unknown };

export async function updateDriverDetails(
  client: PoolClient,
  tripId: string,
  driverId: string,
  update: ParticipantDetailsUpdate & { seatCapacity: number; maxDetourMinutes?: number },
): Promise<boolean> {
  const result = await client.query(
    `UPDATE drivers
        SET name = $3, zone_id = COALESCE($4, zone_id), location = COALESCE($5::jsonb, location),
            seat_capacity = $6, max_detour_minutes = COALESCE($7, max_detour_minutes)
      WHERE trip_id = $1 AND id = $2
        AND (name, zone_id, location, seat_capacity, max_detour_minutes) IS DISTINCT FROM
            ($3, COALESCE($4, zone_id), COALESCE($5::jsonb, location), $6, COALESCE($7, max_detour_minutes))`,
    [tripId, driverId, update.name, update.zoneId, JSON.stringify(update.location), update.seatCapacity, update.maxDetourMinutes],
  );
  return result.rowCount === 1;
}

export async function updateRequestDetails(
  client: PoolClient,
  tripId: string,
  requestId: string,
  update: ParticipantDetailsUpdate,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE ride_requests
        SET name = $3, zone_id = COALESCE($4, zone_id), location = COALESCE($5::jsonb, location)
      WHERE trip_id = $1 AND id = $2
        AND (name, zone_id, location) IS DISTINCT FROM
            ($3, COALESCE($4, zone_id), COALESCE($5::jsonb, location))`,
    [tripId, requestId, update.name, update.zoneId, JSON.stringify(update.location)],
  );
  return result.rowCount === 1;
}

export async function findGuestRegistration(
  client: PoolClient, tripId: string, role: "driver" | "passenger", tokenHash: string,
): Promise<{ id: string; active: boolean } | undefined> {
  const table = role === "driver" ? "drivers" : "ride_requests";
  const result = await client.query<{ id: string; active: boolean }>(
    `SELECT id, active FROM ${table} WHERE trip_id = $1 AND guest_leave_hash = $2`,
    [tripId, tokenHash],
  );
  return result.rows[0];
}

export async function countGuestAssignments(
  client: PoolClient, tripId: string, role: "driver" | "passenger", guestId: string,
): Promise<number> {
  const column = role === "driver" ? "driver_id" : "request_id";
  const result = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM assignments WHERE trip_id = $1 AND ${column} = $2`,
    [tripId, guestId],
  );
  return result.rows[0].count;
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
 * Apply whole-plan invalidation after a roster change or an explicit clear:
 * delete all assignments, clear plan metadata, bump version,
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
    `SELECT ${DRIVER_COLUMNS} FROM drivers WHERE trip_id = $1 ORDER BY created_at, id`,
    [tripId],
  );
  return result.rows;
}

export async function listRequests(
  client: PoolClient,
  tripId: string,
): Promise<RequestRow[]> {
  const result = await client.query<RequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM ride_requests WHERE trip_id = $1 ORDER BY created_at, id`,
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
  cost_unit: "zone_cost" | "detour_seconds";
  routing_policy: string | null;
  /** Public estimate summary (address previews). The private evidence is never in this row. */
  summary: unknown;
}

// Display reads and stored hits select exactly these columns. The private leg
// evidence column is deliberately absent; only commit loads it, through
// findPreviewEvidence.
const PREVIEW_COLUMNS =
  "id, trip_id, base_version, algorithm_version, optimal_result, greedy_result, cost_unit, routing_policy, summary";

/** Find an immutable preview by its unique (trip, version, algorithm) key. */
export async function findPreviewByKey(
  client: PoolClient,
  tripId: string,
  baseVersion: number,
  algorithmVersion: string,
): Promise<PreviewRow | undefined> {
  const result = await client.query<PreviewRow>(
    `SELECT ${PREVIEW_COLUMNS}
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
    `SELECT ${PREVIEW_COLUMNS} FROM match_previews WHERE trip_id = $1 AND id = $2`,
    [tripId, previewId],
  );
  return result.rows[0];
}

/**
 * The NEWEST earlier preview of this trip under this routing policy, which is the
 * one candidate offered for reuse: the highest base version at or below
 * `maxVersion` (ties by preview ID). Its schema is deliberately NOT part of the
 * query. If the newest row cannot be read, the caller discards the whole
 * candidate rather than silently reaching for an older row, so a missing or
 * wiped schema must still be returned here to be noticed. This loads the private
 * evidence column, which only leg reuse and commit ever do.
 */
export async function findReuseCandidate(
  client: PoolClient,
  tripId: string,
  routingPolicy: string,
  maxVersion: number,
): Promise<{ id: string; baseVersion: number; algorithmVersion: string; evidence: unknown } | undefined> {
  const result = await client.query<{ id: string; base_version: number; algorithm_version: string; evidence: unknown }>(
    `SELECT id, base_version, algorithm_version, evidence
       FROM match_previews
      WHERE trip_id = $1 AND routing_policy = $2 AND cost_unit = 'detour_seconds'
        AND base_version <= $3
      ORDER BY base_version DESC, id DESC
      LIMIT 1`,
    [tripId, routingPolicy, maxVersion],
  );
  const row = result.rows[0];
  return row && { id: row.id, baseVersion: row.base_version, algorithmVersion: row.algorithm_version, evidence: row.evidence };
}

/**
 * The public estimate summary of a preview, with the routing policy recorded in
 * the row's own column so the summary can be checked against it. Never selects
 * the private evidence column.
 */
export async function findPreviewSummary(
  client: PoolClient,
  tripId: string,
  previewId: string,
): Promise<{ summary: unknown; routingPolicy: string | null } | undefined> {
  const result = await client.query<{ summary: unknown; routing_policy: string | null }>(
    "SELECT summary, routing_policy FROM match_previews WHERE trip_id = $1 AND id = $2",
    [tripId, previewId],
  );
  const row = result.rows[0];
  return row && { summary: row.summary, routingPolicy: row.routing_policy };
}

/**
 * What a stored result is checked against before it is served again: the id,
 * seat count and activity of every driver and the id and activity of every
 * passenger. No locations and no private evidence.
 */
export async function listParticipantFacts(
  client: PoolClient,
  tripId: string,
): Promise<{
  drivers: Array<{ id: string; seats: number; active: boolean }>;
  passengers: Array<{ id: string; active: boolean }>;
}> {
  const [drivers, passengers] = await Promise.all([
    client.query<{ id: string; seat_capacity: number; active: boolean }>(
      "SELECT id, seat_capacity, active FROM drivers WHERE trip_id = $1", [tripId]),
    client.query<{ id: string; active: boolean }>(
      "SELECT id, active FROM ride_requests WHERE trip_id = $1", [tripId]),
  ]);
  return {
    drivers: drivers.rows.map((d) => ({ id: d.id, seats: d.seat_capacity, active: d.active })),
    passengers: passengers.rows,
  };
}

/** Load a preview's private routing evidence. Used by commit only. */
export async function findPreviewEvidence(
  client: PoolClient,
  tripId: string,
  previewId: string,
): Promise<unknown> {
  const result = await client.query<{ evidence: unknown }>(
    "SELECT evidence FROM match_previews WHERE trip_id = $1 AND id = $2",
    [tripId, previewId],
  );
  return result.rows[0]?.evidence;
}

export async function insertPreview(
  client: PoolClient,
  preview: {
    tripId: string;
    baseVersion: number;
    algorithmVersion: string;
    optimalResult: unknown;
    greedyResult: unknown;
    /** Present for an address preview: its policy, public summary and private evidence. */
    address?: { routingPolicy: string; summary: unknown; evidence: unknown };
  },
): Promise<PreviewRow> {
  const address = preview.address;
  const result = await client.query<PreviewRow>(
    `INSERT INTO match_previews
       (trip_id, base_version, algorithm_version, optimal_result, greedy_result,
        cost_unit, routing_policy, summary, evidence)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8::jsonb, $9::jsonb)
     RETURNING ${PREVIEW_COLUMNS}`,
    [
      preview.tripId,
      preview.baseVersion,
      preview.algorithmVersion,
      JSON.stringify(preview.optimalResult),
      JSON.stringify(preview.greedyResult),
      address ? "detour_seconds" : "zone_cost",
      address ? address.routingPolicy : null,
      address ? JSON.stringify(address.summary) : null,
      address ? JSON.stringify(address.evidence) : null,
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
  if (commitPlanMidHook) await commitPlanMidHook();
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
