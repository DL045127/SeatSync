// Trip service: the sole owner of application writes. It normalizes input,
// enforces bounds and active-status rules, and routes every mutation through
// the shared keyed-mutation helper. Roster changes follow whole-plan
// invalidation (docs/ARCHITECTURE.md sections 4 and 6).

import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { StoredDataError, TerminalBusinessError } from "../contracts/errors.ts";
import {
  LIMITS,
  isAddressAddDriver,
  isAddressAddRequest,
  isAddressCreateTrip,
  normalizeAddDriver,
  normalizeAddRequest,
  normalizeClearPlan,
  normalizeCreateTrip,
  normalizeEditDriver,
  normalizeEditRequest,
  normalizeGuestLeave,
  normalizeUuid,
  type GuestTripStatus,
} from "../contracts/index.ts";
import { verifyAttachment } from "../locations/selection-service.ts";
import { parseStoredSnapshot, type LocationSnapshot } from "../locations/snapshot.ts";
import { parseSummary, type EstimateSummary } from "./address-evidence.ts";
import { tripProvider } from "./address-roster.ts";
import { assertDataset, canonicalDataset } from "../db/dataset.ts";
import { datasetLock } from "../db/local-target.ts";
import { withTransaction } from "../db/transaction.ts";
import {
  type AppliedResult,
  type MutationResponse,
  runKeyedMutation,
} from "./mutation.ts";
import * as repo from "./repository.ts";

/** The display fields of a stored address. Coordinates and IDs stay server-side. */
export interface LocationView {
  label: string;
  detail: string;
  precision: string;
  provider: string;
  attribution: string;
}

function viewOf(value: unknown): LocationView {
  const s: LocationSnapshot = parseStoredSnapshot(value);
  const { street, city, state, postcode } = s.address;
  const place = [city, [state, postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return {
    label: s.label,
    detail: [street, place].filter(Boolean).join(", "),
    precision: s.precision,
    provider: s.provider,
    attribution: s.attribution,
  };
}

export interface TripSnapshot {
  id: string;
  inviteId: string;
  name: string;
  destinationLabel: string;
  departAt: string;
  locationMode: "zone" | "address";
  /** Unit of every cost on this dashboard: zone cost, or estimated extra driving seconds. */
  costUnit: "zone_cost" | "detour_seconds";
  venue: LocationView | null;
  /** The committed plan's public estimate summary (address trips with a saved plan). */
  estimate: EstimateSummary | null;
  status: "open" | "assigned" | "needs_rematch";
  version: number;
  planVersion: number | null;
  algorithmVersion: string | null;
  committedPreviewId: string | null;
  drivers: Array<{
    id: string;
    zoneId: string | null;
    location: LocationView | null;
    maxDetourMinutes: number | null;
    name: string;
    seatCapacity: number;
    active: boolean;
  }>;
  requests: Array<{
    id: string;
    zoneId: string | null;
    location: LocationView | null;
    name: string;
    active: boolean;
  }>;
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
    // The committed plan's public summary. Never the private leg evidence. It is judged against
    // the row that holds it (its own recorded policy, which may be an OLDER policy than today's,
    // so a saved plan stays readable after an upgrade) and the trip's provider, and must be
    // consistent in itself.
    let estimate: EstimateSummary | null = null;
    if (trip.location_mode === "address" && trip.committed_preview_id) {
      const stored = await repo.findPreviewSummary(client, tripId, trip.committed_preview_id);
      if (!stored || stored.routingPolicy === null) {
        throw new StoredDataError("The committed preview of an address trip has no estimate summary.");
      }
      estimate = parseSummary(stored.summary, {
        routingPolicy: stored.routingPolicy,
        provider: tripProvider(trip),
        algorithmVersion: trip.algorithm_version ?? undefined,
      });
    }
    return toSnapshot(trip, drivers, requests, assignments, estimate);
  });
}

export async function getTripInvitation(pool: Pool, inviteIdRaw: string) {
  const inviteId = normalizeUuid(inviteIdRaw);
  return withTransaction(pool, "read", async client => {
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    const trip = await repo.readTrip(client, inviteId, true);
    return trip ? {
      name: trip.name,
      destinationLabel: trip.destination_label,
      departAt: new Date(trip.depart_at).toISOString(),
      locationMode: trip.location_mode,
    } : undefined;
  });
}

function toSnapshot(
  trip: repo.TripRow,
  drivers: repo.DriverRow[],
  requests: repo.RequestRow[],
  assignments: repo.AssignmentRow[],
  estimate: EstimateSummary | null,
): TripSnapshot {
  const totalCost = assignments.reduce((s, a) => s + a.pickup_cost, 0);
  const seatsAvailable = drivers
    .filter((d) => d.active)
    .reduce((s, d) => s + d.seat_capacity, 0);
  return {
    id: trip.id,
    inviteId: trip.invite_id,
    name: trip.name,
    destinationLabel: trip.destination_label,
    departAt: trip.depart_at,
    locationMode: trip.location_mode,
    costUnit: trip.location_mode === "address" ? "detour_seconds" : "zone_cost",
    venue: trip.location_mode === "address" ? viewOf(trip.venue_location) : null,
    estimate,
    status: trip.status,
    version: trip.version,
    planVersion: trip.plan_version,
    algorithmVersion: trip.algorithm_version,
    committedPreviewId: trip.committed_preview_id,
    drivers: drivers.map((d) => ({
      id: d.id,
      zoneId: d.zone_id,
      location: d.location_mode === "address" ? viewOf(d.location) : null,
      maxDetourMinutes: d.max_detour_minutes,
      name: d.name,
      seatCapacity: d.seat_capacity,
      active: d.active,
    })),
    requests: requests.map((r) => ({
      id: r.id,
      zoneId: r.zone_id,
      location: r.location_mode === "address" ? viewOf(r.location) : null,
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
      // The address form verifies its venue token here, inside keyed work, so a
      // matching receipt has already replayed before any signature, expiry or
      // provider check (docs/ARCHITECTURE-v2.md section 3).
      const trip = isAddressCreateTrip(body)
        ? await createAddressTrip(client, body)
        : await repo.insertTrip(client, body);
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
  byInvite = false,
): Promise<MutationResponse> {
  const scopeId = normalizeUuid(tripIdRaw);
  const key = normalizeUuid(requestKey);
  const body = normalizeAddDriver(rawBody, canonicalZoneIds);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "POST",
      canonicalRoute: `/api/${byInvite ? "invites" : "trips"}/${scopeId}/drivers`,
      normalizedBody: body,
    },
    lockTrip: (client) => lockTripOr404(client, scopeId, byInvite),
    work: async ({ client, locked }): Promise<AppliedResult> => {
      const tripId = locked.id;
      requireTripMode(locked, isAddressAddDriver(body) ? "address" : "zone");
      const start = isAddressAddDriver(body)
        ? await verifyAttachment(client, body.startSelectionToken, {
            purpose: "driver_start",
            tripId: scopeId,
            provider: tripProvider(locked),
          })
        : undefined;
      if ((await repo.countDrivers(client, tripId)) >= LIMITS.driversPerTrip) {
        throw new TerminalBusinessError(422, "ROSTER_LIMIT", "Driver record limit reached.");
      }
      const leaveToken = byInvite ? randomUUID() : undefined;
      const guestLeaveHash = leaveToken ? hashGuestToken(leaveToken) : undefined;
      const driver = await repo.insertDriver(
        client,
        isAddressAddDriver(body)
          ? {
              tripId,
              guestLeaveHash,
              location: start,
              maxDetourMinutes: body.maxDetourMinutes,
              name: body.name,
              seatCapacity: body.seatCapacity,
            }
          : { tripId, guestLeaveHash, zoneId: body.zoneId, name: body.name, seatCapacity: body.seatCapacity },
      );
      const version = await applyRosterChange(client, locked);
      return appliedRoster(key, 201, { id: driver.id, mutationVersion: version, ...(leaveToken ? { leaveToken } : {}) });
    },
    makeRequestId: requestId,
  });
}

export async function addRequest(
  pool: Pool,
  tripIdRaw: string,
  requestKey: string,
  rawBody: unknown,
  byInvite = false,
): Promise<MutationResponse> {
  const scopeId = normalizeUuid(tripIdRaw);
  const key = normalizeUuid(requestKey);
  const body = normalizeAddRequest(rawBody, canonicalZoneIds);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "POST",
      canonicalRoute: `/api/${byInvite ? "invites" : "trips"}/${scopeId}/requests`,
      normalizedBody: body,
    },
    lockTrip: (client) => lockTripOr404(client, scopeId, byInvite),
    work: async ({ client, locked }): Promise<AppliedResult> => {
      const tripId = locked.id;
      requireTripMode(locked, isAddressAddRequest(body) ? "address" : "zone");
      const pickup = isAddressAddRequest(body)
        ? await verifyAttachment(client, body.pickupSelectionToken, {
            purpose: "pickup",
            tripId: scopeId,
            provider: tripProvider(locked),
          })
        : undefined;
      if ((await repo.countRequests(client, tripId)) >= LIMITS.passengersPerTrip) {
        throw new TerminalBusinessError(422, "ROSTER_LIMIT", "Passenger record limit reached.");
      }
      const leaveToken = byInvite ? randomUUID() : undefined;
      const guestLeaveHash = leaveToken ? hashGuestToken(leaveToken) : undefined;
      const request = await repo.insertRequest(
        client,
        isAddressAddRequest(body)
          ? { tripId, guestLeaveHash, location: pickup, name: body.name }
          : { tripId, guestLeaveHash, zoneId: body.zoneId, name: body.name },
      );
      const version = await applyRosterChange(client, locked);
      return appliedRoster(key, 201, { id: request.id, mutationVersion: version, ...(leaveToken ? { leaveToken } : {}) });
    },
    makeRequestId: requestId,
  });
}

function hashGuestToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function getGuestTripStatus(pool: Pool, inviteRaw: string, rawBody: unknown): Promise<GuestTripStatus> {
  const inviteId = normalizeUuid(inviteRaw);
  const { role, token } = normalizeGuestLeave(rawBody);
  const tokenHash = hashGuestToken(token);
  return withTransaction(pool, "read", async client => {
    await client.query("SELECT pg_advisory_xact_lock_shared($1::int, $2::int)", [...datasetLock]);
    await assertDataset(client);
    const trip = await repo.readTrip(client, inviteId, true);
    const guest = trip && await repo.findGuestRegistration(client, trip.id, role, tokenHash);
    if (!trip || !guest) throw new TerminalBusinessError(404, "NOT_FOUND", "This private registration link is invalid.");
    if (!guest.active) return { state: "left" };
    if (trip.status !== "assigned") return { state: "awaiting_plan" };
    return { state: "saved_plan", assignedCount: await repo.countGuestAssignments(client, trip.id, role, guest.id) };
  });
}

export function leaveTrip(pool: Pool, inviteRaw: string, keyRaw: string, rawBody: unknown): Promise<MutationResponse> {
  const inviteId = normalizeUuid(inviteRaw);
  const key = normalizeUuid(keyRaw);
  const body = normalizeGuestLeave(rawBody);
  const { role } = body;
  const tokenHash = hashGuestToken(body.token);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "POST",
      canonicalRoute: `/api/invites/${inviteId}/leave`,
      normalizedBody: { role, tokenHash },
    },
    lockTrip: client => lockTripOr404(client, inviteId, true),
    work: async ({ client, locked: trip }) => {
      const guest = await repo.findGuestRegistration(client, trip.id, role, tokenHash);
      if (!guest) throw new TerminalBusinessError(404, "NOT_FOUND", "This private registration link is invalid.");
      if (!guest.active) return appliedRoster(key, 200, { mutationVersion: trip.version });
      const deactivate = role === "driver" ? repo.cancelDriver : repo.withdrawRequestRow;
      await deactivate(client, trip.id, guest.id);
      const mutationVersion = await applyRosterChange(client, trip);
      return appliedRoster(key, 200, { mutationVersion });
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
  const body = normalizeEditDriver(rawBody, canonicalZoneIds);
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

      // Editing requires an active driver.
      if (!driver.active) {
        throw new TerminalBusinessError(
          422,
          "RESOURCE_INACTIVE",
          "Cannot edit a canceled driver.",
        );
      }
      if ("details" in body) {
        const details = body.details;
        const zone = "zoneId" in details;
        requireTripMode(trip, zone ? "zone" : "address");
        const location = !zone && details.startSelectionToken !== undefined
          ? await verifyAttachment(client, details.startSelectionToken, {
              purpose: "driver_start", tripId, provider: tripProvider(trip),
            })
          : undefined;
        const changed = await repo.updateDriverDetails(client, tripId, driverId, { ...details, location });
        const version = changed ? await applyRosterChange(client, trip) : trip.version;
        return appliedRoster(key, 200, { mutationVersion: version });
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

export async function editRequest(
  pool: Pool,
  tripIdRaw: string,
  requestIdRaw: string,
  requestKey: string,
  rawBody: unknown,
): Promise<MutationResponse> {
  const tripId = normalizeUuid(tripIdRaw);
  const rideRequestId = normalizeUuid(requestIdRaw);
  const key = normalizeUuid(requestKey);
  const body = normalizeEditRequest(rawBody, canonicalZoneIds);
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
      if ("details" in body) {
        if (!request.active) {
          throw new TerminalBusinessError(422, "RESOURCE_INACTIVE", "Cannot edit a withdrawn passenger.");
        }
        const details = body.details;
        const zone = "zoneId" in details;
        requireTripMode(trip, zone ? "zone" : "address");
        const location = !zone && details.pickupSelectionToken !== undefined
          ? await verifyAttachment(client, details.pickupSelectionToken, {
              purpose: "pickup", tripId, provider: tripProvider(trip),
            })
          : undefined;
        const changed = await repo.updateRequestDetails(client, tripId, rideRequestId, { ...details, location });
        const version = changed ? await applyRosterChange(client, trip) : trip.version;
        return appliedRoster(key, 200, { mutationVersion: version });
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

export { editRequest as withdrawRequest };

export function clearPlan(pool: Pool, tripIdRaw: string, requestKey: string, rawBody: unknown): Promise<MutationResponse> {
  const tripId = normalizeUuid(tripIdRaw);
  const key = normalizeUuid(requestKey);
  const body = normalizeClearPlan(rawBody);
  return runKeyedMutation({
    pool,
    request: {
      requestKey: key,
      method: "POST",
      canonicalRoute: `/api/trips/${tripId}/match/clear`,
      normalizedBody: body,
    },
    lockTrip: client => lockTripOr404(client, tripId),
    work: async ({ client, locked: trip }) => {
      requireBaseVersion(trip, body.baseVersion);
      const mutationVersion = trip.status === "assigned"
        ? await repo.invalidatePlanAndBump(client, trip.id)
        : trip.version;
      return appliedRoster(key, 200, { mutationVersion });
    },
    makeRequestId: requestId,
  });
}

// ---- helpers ----

async function createAddressTrip(
  client: PoolClient,
  body: { name: string; departAt: string; venueSelectionToken: string },
): Promise<repo.TripRow> {
  const venue = await verifyAttachment(client, body.venueSelectionToken, { purpose: "venue", tripId: null });
  return repo.insertTrip(client, {
    name: body.name,
    // The label is bounded to the destination column's limit by the snapshot schema.
    destinationLabel: venue.label,
    departAt: body.departAt,
    venueLocation: venue,
  });
}

/** A form for the other mode is a terminal, receipted rejection under the trip lock. */
function requireTripMode(trip: repo.TripRow, mode: "zone" | "address"): void {
  if (trip.location_mode !== mode) {
    throw new TerminalBusinessError(
      422,
      "LOCATION_MODE_MISMATCH",
      mode === "address"
        ? "This trip uses zones; register with a zone."
        : "This trip uses addresses; register with a searched address.",
    );
  }
}

/**
 * Lock the trip row FOR UPDATE before the savepoint (ISSUE-015). A missing trip
 * is a terminal 404 raised here; because it is raised in the lockTrip phase,
 * before the savepoint, the helper still finalizes it as a not_applied receipt.
 */
async function lockTripOr404(client: PoolClient, tripId: string, byInvite = false): Promise<repo.TripRow> {
  const trip = await repo.lockTrip(client, tripId, byInvite);
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
