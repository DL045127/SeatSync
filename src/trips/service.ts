// Trip service: the sole owner of application writes. It normalizes input,
// enforces bounds and active-status rules, and routes every mutation through
// the shared keyed-mutation helper. Roster changes follow whole-plan
// invalidation (docs/ARCHITECTURE.md sections 4 and 6).

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { TerminalBusinessError } from "../contracts/errors.ts";
import {
  LIMITS,
  normalizeAddDriver,
  normalizeAddRequest,
  normalizeCreateTrip,
  normalizeEditDriver,
  normalizeUuid,
  normalizeWithdrawRequest,
} from "../contracts/index.ts";
import { assertDataset, canonicalDataset } from "../db/dataset.ts";
import { datasetLock } from "../db/local-target.ts";
import { withTransaction } from "../db/transaction.ts";
import {
  type AppliedResult,
  type MutationResponse,
  runKeyedMutation,
} from "./mutation.ts";
import * as repo from "./repository.ts";

export interface TripSnapshot {
  id: string;
  name: string;
  destinationLabel: string;
  departAt: string;
  status: "open" | "assigned" | "needs_rematch";
  version: number;
  planVersion: number | null;
  algorithmVersion: string | null;
  committedPreviewId: string | null;
  drivers: Array<{
    id: string;
    zoneId: string;
    name: string;
    seatCapacity: number;
    active: boolean;
  }>;
  requests: Array<{ id: string; zoneId: string; name: string; active: boolean }>;
  assignments: Array<{ requestId: string; driverId: string; pickupCost: number }>;
  totals: { matched: number; totalCost: number; seatsUsed: number; seatsAvailable: number };
}

const requestId = () => randomUUID();

// Test-only barrier for the dashboard snapshot read (C-08). The W4 suite
// installs a one-shot hook that commits a cancellation after the snapshot's
// trip-row read, then clears it. Production never sets it.
let snapshotBarrier: () => Promise<void> = () => Promise.resolve();
export function __setSnapshotBarrier(hook: () => Promise<void>): () => void {
  snapshotBarrier = hook;
  return () => { snapshotBarrier = () => Promise.resolve(); };
}

/**
 * Zone IDs come from the immutable canonical fixture, NOT a runtime SELECT
 * (ISSUE-016). A preliminary DB read could cache drifted zones before the
 * dataset guard runs; validating against the bundled fixture keeps registration
 * consistent, and the guarded mutation transaction still rejects a drifted
 * database with DATASET_MISMATCH.
 */
const canonicalZoneIds: ReadonlySet<string> = new Set(
  canonicalDataset.zones.map((z) => z.id),
);

/**
 * Consistent read of a trip snapshot in one REPEATABLE READ READ ONLY
 * transaction under the shared dataset lock, so versions never mix across
 * queries. Returns undefined when the trip is not found.
 */
export async function getTripSnapshot(
  pool: Pool,
  tripIdRaw: string,
): Promise<TripSnapshot | undefined> {
  const tripId = normalizeUuid(tripIdRaw);
  return withTransaction(pool, "read", async (client) => {
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    const trip = await repo.readTrip(client, tripId);
    if (!trip) return undefined;
    // Test-only barrier (C-08): fires after the trip row read, before the roster
    // reads, so a test can commit a cancellation in between and prove the
    // REPEATABLE READ snapshot returns an internally consistent view (never a
    // new driver set against an old trip row). Production never sets it.
    await snapshotBarrier();
    const [drivers, requests, assignments] = await Promise.all([
      repo.listDrivers(client, tripId),
      repo.listRequests(client, tripId),
      repo.listAssignments(client, tripId),
    ]);
    return toSnapshot(trip, drivers, requests, assignments);
  });
}

function toSnapshot(
  trip: repo.TripRow,
  drivers: repo.DriverRow[],
  requests: repo.RequestRow[],
  assignments: repo.AssignmentRow[],
): TripSnapshot {
  const totalCost = assignments.reduce((s, a) => s + a.pickup_cost, 0);
  const seatsAvailable = drivers
    .filter((d) => d.active)
    .reduce((s, d) => s + d.seat_capacity, 0);
  return {
    id: trip.id,
    name: trip.name,
    destinationLabel: trip.destination_label,
    departAt: trip.depart_at,
    status: trip.status,
    version: trip.version,
    planVersion: trip.plan_version,
    algorithmVersion: trip.algorithm_version,
    committedPreviewId: trip.committed_preview_id,
    drivers: drivers.map((d) => ({
      id: d.id,
      zoneId: d.zone_id,
      name: d.name,
      seatCapacity: d.seat_capacity,
      active: d.active,
    })),
    requests: requests.map((r) => ({
      id: r.id,
      zoneId: r.zone_id,
      name: r.name,
      active: r.active,
    })),
    assignments: assignments.map((a) => ({
      requestId: a.request_id,
      driverId: a.driver_id,
      pickupCost: a.pickup_cost,
    })),
    totals: {
      matched: assignments.length,
      totalCost,
      seatsUsed: assignments.length,
      seatsAvailable,
    },
  };
}

// ---- Mutations ----

export function createTrip(
  pool: Pool,
  requestKey: string,
  rawBody: unknown,
): Promise<MutationResponse> {
  const body = normalizeCreateTrip(rawBody);
  const key = normalizeUuid(requestKey);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "POST",
      canonicalRoute: "/api/trips",
      normalizedBody: body,
    },
    work: async ({ client }): Promise<AppliedResult> => {
      const trip = await repo.insertTrip(client, body);
      return {
        httpStatus: 201,
        body: {
          id: trip.id,
          mutationVersion: trip.version,
          operation: { key, outcome: "applied" },
        },
      };
    },
    makeRequestId: requestId,
  });
}

export async function addDriver(
  pool: Pool,
  tripIdRaw: string,
  requestKey: string,
  rawBody: unknown,
): Promise<MutationResponse> {
  const tripId = normalizeUuid(tripIdRaw);
  const key = normalizeUuid(requestKey);
  const body = normalizeAddDriver(rawBody, canonicalZoneIds);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/drivers`,
      normalizedBody: body,
    },
    lockTrip: (client) => lockTripOr404(client, tripId),
    work: async ({ client, locked }): Promise<AppliedResult> => {
      if ((await repo.countDrivers(client, tripId)) >= LIMITS.driversPerTrip) {
        throw new TerminalBusinessError(422, "ROSTER_LIMIT", "Driver record limit reached.");
      }
      const driver = await repo.insertDriver(client, {
        tripId,
        zoneId: body.zoneId,
        name: body.name,
        seatCapacity: body.seatCapacity,
      });
      const version = await applyRosterChange(client, locked);
      return appliedRoster(key, 201, { id: driver.id, mutationVersion: version });
    },
    makeRequestId: requestId,
  });
}

export async function addRequest(
  pool: Pool,
  tripIdRaw: string,
  requestKey: string,
  rawBody: unknown,
): Promise<MutationResponse> {
  const tripId = normalizeUuid(tripIdRaw);
  const key = normalizeUuid(requestKey);
  const body = normalizeAddRequest(rawBody, canonicalZoneIds);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/requests`,
      normalizedBody: body,
    },
    lockTrip: (client) => lockTripOr404(client, tripId),
    work: async ({ client, locked }): Promise<AppliedResult> => {
      if ((await repo.countRequests(client, tripId)) >= LIMITS.passengersPerTrip) {
        throw new TerminalBusinessError(422, "ROSTER_LIMIT", "Passenger record limit reached.");
      }
      const request = await repo.insertRequest(client, {
        tripId,
        zoneId: body.zoneId,
        name: body.name,
      });
      const version = await applyRosterChange(client, locked);
      return appliedRoster(key, 201, { id: request.id, mutationVersion: version });
    },
    makeRequestId: requestId,
  });
}

export async function editDriver(
  pool: Pool,
  tripIdRaw: string,
  driverIdRaw: string,
  requestKey: string,
  rawBody: unknown,
): Promise<MutationResponse> {
  const tripId = normalizeUuid(tripIdRaw);
  const driverId = normalizeUuid(driverIdRaw);
  const key = normalizeUuid(requestKey);
  const body = normalizeEditDriver(rawBody);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "PATCH",
      canonicalRoute: `/api/trips/${tripId}/drivers/${driverId}`,
      normalizedBody: body,
    },
    lockTrip: (client) => lockTripOr404(client, tripId),
    work: async ({ client, locked: trip }): Promise<AppliedResult> => {
      requireBaseVersion(trip, body.baseVersion);
      const driver = await repo.findDriver(client, tripId, driverId);
      if (!driver) {
        throw new TerminalBusinessError(404, "NOT_FOUND", "Driver not found in this trip.");
      }

      if ("active" in body) {
        // Cancellation. A repeat on an already-canceled driver is a no-op.
        if (!driver.active) return appliedRoster(key, 200, { mutationVersion: trip.version });
        await repo.cancelDriver(client, tripId, driverId);
        const version = await applyRosterChange(client, trip);
        return appliedRoster(key, 200, { mutationVersion: version });
      }

      // Capacity edit requires an active driver.
      if (!driver.active) {
        throw new TerminalBusinessError(
          422,
          "RESOURCE_INACTIVE",
          "Cannot edit the capacity of a canceled driver.",
        );
      }
      if (driver.seat_capacity === body.seatCapacity) {
        // Successful no-op: no version bump, no invalidation.
        return appliedRoster(key, 200, { mutationVersion: trip.version });
      }
      await repo.updateDriverCapacity(client, tripId, driverId, body.seatCapacity);
      const version = await applyRosterChange(client, trip);
      return appliedRoster(key, 200, { mutationVersion: version });
    },
    makeRequestId: requestId,
  });
}

export async function withdrawRequest(
  pool: Pool,
  tripIdRaw: string,
  requestIdRaw: string,
  requestKey: string,
  rawBody: unknown,
): Promise<MutationResponse> {
  const tripId = normalizeUuid(tripIdRaw);
  const rideRequestId = normalizeUuid(requestIdRaw);
  const key = normalizeUuid(requestKey);
  const body = normalizeWithdrawRequest(rawBody);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "PATCH",
      canonicalRoute: `/api/trips/${tripId}/requests/${rideRequestId}`,
      normalizedBody: body,
    },
    lockTrip: (client) => lockTripOr404(client, tripId),
    work: async ({ client, locked: trip }): Promise<AppliedResult> => {
      requireBaseVersion(trip, body.baseVersion);
      const request = await repo.findRequest(client, tripId, rideRequestId);
      if (!request) {
        throw new TerminalBusinessError(404, "NOT_FOUND", "Request not found in this trip.");
      }
      if (!request.active) {
        // Repeat withdrawal is a no-op.
        return appliedRoster(key, 200, { mutationVersion: trip.version });
      }
      await repo.withdrawRequestRow(client, tripId, rideRequestId);
      const version = await applyRosterChange(client, trip);
      return appliedRoster(key, 200, { mutationVersion: version });
    },
    makeRequestId: requestId,
  });
}

// ---- helpers ----

/**
 * Lock the trip row FOR UPDATE before the savepoint (ISSUE-015). A missing trip
 * is a terminal 404 raised here; because it is raised in the lockTrip phase,
 * before the savepoint, the helper still finalizes it as a not_applied receipt.
 */
async function lockTripOr404(client: PoolClient, tripId: string): Promise<repo.TripRow> {
  const trip = await repo.lockTrip(client, tripId);
  if (!trip) throw new TerminalBusinessError(404, "NOT_FOUND", "Trip not found.");
  return trip;
}

function requireBaseVersion(trip: repo.TripRow, baseVersion: number): void {
  if (trip.version !== baseVersion) {
    throw new TerminalBusinessError(
      409,
      "STALE_VERSION",
      "The trip changed since this edit was prepared.",
      { currentVersion: trip.version },
    );
  }
}

/**
 * Apply an effective roster change: while open, bump version only; while
 * assigned or needs_rematch, invalidate the whole plan and bump. Returns the
 * new trip version.
 */
async function applyRosterChange(
  client: PoolClient,
  trip: repo.TripRow,
): Promise<number> {
  if (trip.status === "open") return repo.bumpVersionOpen(client, trip.id);
  return repo.invalidatePlanAndBump(client, trip.id);
}

function appliedRoster(
  requestKey: string,
  httpStatus: number,
  extra: Record<string, unknown>,
): AppliedResult {
  return {
    httpStatus,
    body: {
      ...extra,
      operation: { key: normalizeUuid(requestKey), outcome: "applied" },
    },
  };
}
